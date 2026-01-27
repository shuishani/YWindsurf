/**
 * 126/163 邮箱验证码接收器
 * 通过 POP3 协议直接连接邮箱服务器获取邮件
 */

const { createTaggedLogger } = require('../utils/logger');

class Email126Receiver {
  constructor(config) {
    this.config = config;
    this.logger = createTaggedLogger('126邮箱');
  }

  /**
   * 获取验证码
   * @param {string} targetEmail - 目标邮箱地址（注册用的126邮箱）
   * @param {number} maxWaitTime - 最大等待时间（毫秒）
   */
  async getVerificationCode(targetEmail, maxWaitTime = 120000) {
    const Pop3Command = require('node-pop3');
    
    // 确定邮箱类型和服务器
    const mailType = this.config.mailType || '126';
    const servers = {
      '126': 'pop.126.com',
      '163': 'pop.163.com'
    };
    const server = servers[mailType] || 'pop.126.com';
    
    this.logger.info('开始获取验证码', `目标: ${targetEmail}`);
    
    const startTime = Date.now();
    const checkInterval = 5000; // 每5秒检查一次
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const code = await this.checkMailForCode(server, targetEmail);
        if (code) {
          this.logger.success('验证码获取成功', code);
          return code;
        }
      } catch (error) {
        this.logger.warning('检查邮件失败', error.message);
      }
      
      // 等待后重试
      await this.sleep(checkInterval);
    }
    
    throw new Error('获取验证码超时');
  }

  /**
   * 检查邮件中的验证码
   */
  async checkMailForCode(server, targetEmail) {
    const Pop3Command = require('node-pop3');
    
    const pop3 = new Pop3Command({
      host: server,
      port: 995,
      tls: true,
      user: this.config.user,
      password: this.config.password,
      tlsOptions: { rejectUnauthorized: false }
    });

    try {
      // 连接并获取邮件列表
      const list = await pop3.UIDL();
      
      if (!list || list.length === 0) {
        await pop3.QUIT();
        return null;
      }

      // 获取最近5封邮件
      const recentMails = list.slice(-5);
      
      for (const mail of recentMails.reverse()) {
        const mailId = mail[0];
        const content = await pop3.RETR(mailId);
        
        // 解析邮件内容
        const code = this.extractCodeFromMail(content, targetEmail);
        if (code) {
          await pop3.QUIT();
          return code;
        }
      }

      await pop3.QUIT();
      return null;
      
    } catch (error) {
      try { await pop3.QUIT(); } catch (e) {}
      throw error;
    }
  }

  /**
   * 从邮件内容中提取验证码
   */
  extractCodeFromMail(mailContent, targetEmail) {
    // 检查是否是 Windsurf 相关邮件
    const isWindsurfEmail = 
      mailContent.toLowerCase().includes('windsurf') ||
      mailContent.toLowerCase().includes('verify') ||
      mailContent.toLowerCase().includes('codeium') ||
      mailContent.toLowerCase().includes('exafunction');
    
    if (!isWindsurfEmail) {
      return null;
    }

    // 检查是否发送给目标邮箱
    if (!mailContent.toLowerCase().includes(targetEmail.toLowerCase())) {
      return null;
    }

    // 提取验证码
    const patterns = [
      /\b(\d{6})\b/,                    // 6位数字
      /验证码[：:]\s*(\d{4,8})/,
      /code[：:\s]+(\d{4,8})/i,
      /verification code[：:\s]+(\d{4,8})/i
    ];

    for (const pattern of patterns) {
      const match = mailContent.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * 测试连接
   */
  async testConnection() {
    const Pop3Command = require('node-pop3');
    
    const mailType = this.config.mailType || '126';
    const servers = {
      '126': 'pop.126.com',
      '163': 'pop.163.com'
    };
    const server = servers[mailType] || 'pop.126.com';

    this.logger.info('测试POP3连接', `${server}:995`);

    const pop3 = new Pop3Command({
      host: server,
      port: 995,
      tls: true,
      user: this.config.user,
      password: this.config.password,
      tlsOptions: { rejectUnauthorized: false }
    });

    try {
      const list = await pop3.UIDL();
      await pop3.QUIT();
      
      this.logger.success('连接成功', `邮箱中有 ${list.length} 封邮件`);
      return { success: true, message: `连接成功，邮箱中有 ${list.length} 封邮件` };
    } catch (error) {
      this.logger.error('连接失败', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取最近的邮件列表
   */
  async getRecentMails(count = 5) {
    const Pop3Command = require('node-pop3');
    
    const mailType = this.config.mailType || '126';
    const servers = {
      '126': 'pop.126.com',
      '163': 'pop.163.com'
    };
    const server = servers[mailType] || 'pop.126.com';

    const pop3 = new Pop3Command({
      host: server,
      port: 995,
      tls: true,
      user: this.config.user,
      password: this.config.password,
      tlsOptions: { rejectUnauthorized: false }
    });

    try {
      const list = await pop3.UIDL();
      
      if (!list || list.length === 0) {
        await pop3.QUIT();
        return [];
      }

      const mails = [];
      const recentMails = list.slice(-count);
      
      for (const mail of recentMails.reverse()) {
        const mailId = mail[0];
        const content = await pop3.RETR(mailId);
        
        // 解析邮件头
        const parsed = this.parseMailHeaders(content);
        
        mails.push({
          id: mailId,
          subject: parsed.subject,
          from: parsed.from,
          raw: content.substring(0, 500)
        });
      }

      await pop3.QUIT();
      return mails;
      
    } catch (error) {
      try { await pop3.QUIT(); } catch (e) {}
      throw error;
    }
  }

  /**
   * 解析邮件头
   */
  parseMailHeaders(rawMail) {
    const result = { subject: '', from: '', to: '' };
    
    // 分离头部和正文
    const headerEnd = rawMail.indexOf('\r\n\r\n');
    const headers = headerEnd > 0 ? rawMail.substring(0, headerEnd) : rawMail;
    
    // 解析 Subject
    const subjectMatch = headers.match(/^Subject:\s*(.+?)(?:\r?\n(?!\s)|$)/im);
    if (subjectMatch) {
      result.subject = this.decodeMailHeader(subjectMatch[1].trim());
    }
    
    // 解析 From
    const fromMatch = headers.match(/^From:\s*(.+?)(?:\r?\n(?!\s)|$)/im);
    if (fromMatch) {
      result.from = this.decodeMailHeader(fromMatch[1].trim());
    }
    
    // 解析 To
    const toMatch = headers.match(/^To:\s*(.+?)(?:\r?\n(?!\s)|$)/im);
    if (toMatch) {
      result.to = this.decodeMailHeader(toMatch[1].trim());
    }
    
    return result;
  }

  /**
   * 解码邮件头（处理 Base64 和 Quoted-Printable 编码）
   */
  decodeMailHeader(str) {
    if (!str) return '';
    
    // 处理 =?charset?encoding?text?= 格式
    const regex = /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi;
    
    return str.replace(regex, (match, charset, encoding, text) => {
      try {
        if (encoding.toUpperCase() === 'B') {
          // Base64 解码
          return Buffer.from(text, 'base64').toString('utf-8');
        } else if (encoding.toUpperCase() === 'Q') {
          // Quoted-Printable 解码
          return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
          });
        }
      } catch (e) {}
      return match;
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Email126Receiver;
