const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { createTaggedLogger } = require('../utils/logger');

/**
 * 本地邮箱验证码接收器
 */
class EmailReceiver {
  constructor(config) {
    this.config = config;
    // 使用空标签的日志实例
    this.logger = createTaggedLogger('');
  }

  /**
   * 获取验证码（本地IMAP实现）
   */
  async getVerificationCode(targetEmail, maxWaitTime = 120000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      // 创建IMAP连接
      const imap = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
      });

      let checkInterval;
      let isResolved = false;

      const checkMail = () => {
        if (Date.now() - startTime > maxWaitTime) {
          clearInterval(checkInterval);
          imap.end();
          if (!isResolved) {
            isResolved = true;
            reject(new Error('获取验证码超时'));
          }
          return;
        }

        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            this.logger.error('打开邮箱失败', err.message);
            return;
          }

          // 搜索最近10分钟内的未读邮件，兼顾效率和可靠性
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          const searchCriteria = ['UNSEEN', ['SINCE', tenMinutesAgo]];

          imap.search(searchCriteria, (err, results) => {
            if (err) {
              this.logger.error('搜索邮件失败', err.message);
              return;
            }

            if (!results || results.length === 0) {
              return; // 静默跳过，不输出"暂无新邮件"
            }
            
            // 只有找到邮件时才输出日志，但会在处理过程中进一步过滤

            const fetch = imap.fetch(results, { bodies: '', markSeen: true });

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                simpleParser(stream, (err, parsed) => {
                  if (err || isResolved) return;

                  // 检查邮件主题或内容是否包含Windsurf相关关键词
                  const subject = parsed.subject || '';
                  const from = parsed.from?.text || '';
                  const to = parsed.to?.text || '';
                  
                  // 检查是否是Windsurf相关邮件
                  const isWindsurfEmail = subject.toLowerCase().includes('windsurf') || 
                                         subject.toLowerCase().includes('verify') ||
                                         from.toLowerCase().includes('windsurf') ||
                                         from.toLowerCase().includes('codeium') ||
                                         from.toLowerCase().includes('exafunction');
                  
                  if (!isWindsurfEmail) {
                    return; // 静默跳过非Windsurf邮件
                  }
                  
                  // 检查邮件是否发送给目标邮箱
                  if (!to.includes(targetEmail)) {
                    return; // 静默跳过不匹配的邮件
                  }
                  
                  this.logger.email('找到目标验证邮件', `主题: ${subject}, 收件人: ${targetEmail}`);

                  // 从邮件内容中提取验证码
                  const emailBody = (parsed.text || parsed.html || '').replace(/<[^>]*>/g, '');
                  
                  // 多种验证码格式匹配
                  const patterns = [
                    /\b(\d{6})\b/,                    // 6位数字
                    /\b([A-Z0-9]{6})\b/,              // 6位字母数字
                    /验证码[：:]\s*(\w+)/,             // 中文验证码
                    /code[：:]\s*(\w+)/i,             // 英文code
                    /verification code[：:]\s*(\w+)/i // verification code
                  ];

                  for (const pattern of patterns) {
                    const match = emailBody.match(pattern);
                    if (match) {
                      clearInterval(checkInterval);
                      imap.end();
                      if (!isResolved) {
                        isResolved = true;
                        this.logger.success('找到验证码', match[1]);
                        resolve(match[1]);
                      }
                      return;
                    }
                  }
                });
              });
            });

            fetch.once('error', (err) => {
              this.logger.error('获取邮件失败', err.message);
            });
          });
        });
      };

      imap.once('ready', () => {
        this.logger.network('IMAP连接成功，开始监听验证码邮件');
        checkMail();
        checkInterval = setInterval(checkMail, 10000); // 每10秒检查一次，减少频率
      });

      imap.once('error', (err) => {
        clearInterval(checkInterval);
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`IMAP连接失败: ${err.message}`));
        }
      });

      imap.once('end', () => {
        clearInterval(checkInterval);
        this.logger.network('IMAP连接已关闭');
      });

      imap.connect();
    });
  }

  /**
   * 搜索邮件（获取发送给指定邮箱的最近N封邮件）
   * @param {string} targetEmail - 目标邮箱地址
   * @param {number} limit - 最多返回的邮件数量
   */
  async searchEmails(targetEmail, limit = 50) {
    this.logger.email('开始搜索邮件', `目标: ${targetEmail}, 限制: ${limit}封`);
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
      });

      const messages = [];

      imap.once('ready', () => {
        this.logger.network('IMAP连接成功，开始搜索邮件');
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            this.logger.error('打开邮箱失败', err.message);
            imap.end();
            return reject(err);
          }

          // 搜索所有邮件
          const searchCriteria = ['ALL'];
          
          imap.search(searchCriteria, (err, results) => {
            if (err) {
              this.logger.error('搜索邮件失败', err.message);
              imap.end();
              return reject(err);
            }

            if (!results || results.length === 0) {
              this.logger.info('未找到邮件');
              imap.end();
              return resolve([]);
            }

            // 获取最近的邮件（最多 limit*2 封，因为要过滤目标邮箱）
            const maxFetch = Math.min(results.length, limit * 2);
            const recentResults = results.slice(-maxFetch);
            const fetch = imap.fetch(recentResults, { bodies: '' });

            let processed = 0;
            const total = recentResults.length;

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                simpleParser(stream, (err, parsed) => {
                  processed++;
                  
                  if (err) {
                    // 检查是否所有邮件都处理完了
                    if (processed >= total) {
                      imap.end();
                      resolve(messages.slice(-limit)); // 只返回最近的 limit 封
                    }
                    return;
                  }

                  const to = parsed.to?.text || '';
                  
                  // 只返回发送给目标邮箱的邮件
                  if (to.includes(targetEmail)) {
                    messages.push({
                      subject: parsed.subject || '',
                      from: parsed.from?.text || '',
                      to: to,
                      body: parsed.text || '',
                      html: parsed.html || '',
                      date: parsed.date
                    });
                  }
                  
                  // 检查是否所有邮件都处理完了
                  if (processed >= total) {
                    const filteredMessages = messages.slice(-limit);
                    this.logger.success('邮件搜索完成', `找到 ${filteredMessages.length} 封相关邮件`);
                    imap.end();
                    resolve(filteredMessages);
                  }
                });
              });
            });

            fetch.once('error', (err) => {
              this.logger.error('获取邮件失败', err.message);
              imap.end();
              reject(err);
            });
          });
        });
      });

      imap.once('error', (err) => {
        this.logger.error('IMAP连接失败', err.message);
        reject(err);
      });

      imap.connect();
    });
  }

  /**
   * 测试IMAP连接
   */
  async testConnection() {
    this.logger.network('正在测试IMAP连接');
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
      });

      imap.once('ready', () => {
        this.logger.success('IMAP连接测试成功');
        imap.end();
        resolve({ success: true, message: 'IMAP连接成功' });
      });

      imap.once('error', (err) => {
        this.logger.error('IMAP连接测试失败', err.message);
        resolve({ success: false, error: `IMAP连接失败: ${err.message}` });
      });

      imap.connect();
    });
  }
}

module.exports = EmailReceiver;
