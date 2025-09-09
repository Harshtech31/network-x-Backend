const AWS = require('aws-sdk');

// Configure AWS SES
const ses = new AWS.SES({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Send email using Amazon SES
 * @param {Object} emailData - Email configuration
 * @param {string} emailData.to - Recipient email address
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.htmlBody - HTML email body
 * @param {string} emailData.textBody - Plain text email body
 * @param {string} emailData.from - Sender email address
 * @returns {Promise<Object>} SES response
 */
const sendEmail = async (emailData) => {
  const { to, subject, htmlBody, textBody, from } = emailData;
  
  const params = {
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to]
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: htmlBody
        },
        Text: {
          Charset: 'UTF-8',
          Data: textBody
        }
      },
      Subject: {
        Charset: 'UTF-8',
        Data: subject
      }
    },
    Source: from || process.env.SES_FROM_EMAIL || 'noreply@networkx.com'
  };

  try {
    const result = await ses.sendEmail(params).promise();
    console.log('Email sent successfully:', result.MessageId);
    return result;
  } catch (error) {
    console.error('SES email error:', error);
    throw error;
  }
};

/**
 * Send bulk emails using Amazon SES
 * @param {Object} bulkEmailData - Bulk email configuration
 * @param {Array<string>} bulkEmailData.destinations - Array of recipient email addresses
 * @param {string} bulkEmailData.subject - Email subject
 * @param {string} bulkEmailData.htmlBody - HTML email body
 * @param {string} bulkEmailData.textBody - Plain text email body
 * @param {string} bulkEmailData.from - Sender email address
 * @returns {Promise<Object>} SES response
 */
const sendBulkEmail = async (bulkEmailData) => {
  const { destinations, subject, htmlBody, textBody, from } = bulkEmailData;
  
  const params = {
    Destinations: destinations.map(email => ({
      Destination: {
        ToAddresses: [email]
      },
      ReplacementTags: []
    })),
    DefaultTemplateData: '{}',
    Template: 'NetworkXBulkTemplate',
    Source: from || process.env.SES_FROM_EMAIL || 'noreply@networkx.com'
  };

  try {
    const result = await ses.sendBulkTemplatedEmail(params).promise();
    console.log('Bulk email sent successfully:', result.MessageId);
    return result;
  } catch (error) {
    console.error('SES bulk email error:', error);
    throw error;
  }
};

/**
 * Create email template in SES
 * @param {Object} templateData - Template configuration
 * @param {string} templateData.name - Template name
 * @param {string} templateData.subject - Template subject
 * @param {string} templateData.htmlPart - HTML template
 * @param {string} templateData.textPart - Text template
 * @returns {Promise<Object>} SES response
 */
const createEmailTemplate = async (templateData) => {
  const { name, subject, htmlPart, textPart } = templateData;
  
  const params = {
    Template: {
      TemplateName: name,
      SubjectPart: subject,
      HtmlPart: htmlPart,
      TextPart: textPart
    }
  };

  try {
    const result = await ses.createTemplate(params).promise();
    console.log('Email template created:', name);
    return result;
  } catch (error) {
    console.error('SES template creation error:', error);
    throw error;
  }
};

/**
 * Send templated email using Amazon SES
 * @param {Object} templateEmailData - Template email configuration
 * @param {string} templateEmailData.to - Recipient email address
 * @param {string} templateEmailData.templateName - SES template name
 * @param {Object} templateEmailData.templateData - Template variables
 * @param {string} templateEmailData.from - Sender email address
 * @returns {Promise<Object>} SES response
 */
const sendTemplatedEmail = async (templateEmailData) => {
  const { to, templateName, templateData, from } = templateEmailData;
  
  const params = {
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to]
    },
    Template: templateName,
    TemplateData: JSON.stringify(templateData),
    Source: from || process.env.SES_FROM_EMAIL || 'noreply@networkx.com'
  };

  try {
    const result = await ses.sendTemplatedEmail(params).promise();
    console.log('Templated email sent successfully:', result.MessageId);
    return result;
  } catch (error) {
    console.error('SES templated email error:', error);
    throw error;
  }
};

/**
 * Verify email address for SES
 * @param {string} email - Email address to verify
 * @returns {Promise<Object>} SES response
 */
const verifyEmailAddress = async (email) => {
  const params = {
    EmailAddress: email
  };

  try {
    const result = await ses.verifyEmailIdentity(params).promise();
    console.log('Email verification initiated:', email);
    return result;
  } catch (error) {
    console.error('SES email verification error:', error);
    throw error;
  }
};

/**
 * Get SES sending statistics
 * @returns {Promise<Object>} SES statistics
 */
const getSendingStatistics = async () => {
  try {
    const result = await ses.getSendStatistics().promise();
    return result;
  } catch (error) {
    console.error('SES statistics error:', error);
    throw error;
  }
};

/**
 * Check if SES is properly configured
 * @returns {Promise<boolean>} Configuration status
 */
const checkSESConfiguration = async () => {
  try {
    await ses.getSendQuota().promise();
    console.log('SES configuration is valid');
    return true;
  } catch (error) {
    console.error('SES configuration error:', error);
    return false;
  }
};

// Email templates for common notifications
const EMAIL_TEMPLATES = {
  WELCOME: {
    name: 'NetworkXWelcome',
    subject: 'Welcome to Network-X!',
    htmlPart: `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0;">Welcome to Network-X!</h1>
          </div>
          <div style="padding: 40px;">
            <h2>Hello {{firstName}}!</h2>
            <p>We're excited to have you join the Network-X community. Your account has been successfully created.</p>
            <p>Here's what you can do next:</p>
            <ul>
              <li>Complete your profile to connect with like-minded people</li>
              <li>Join clubs and communities that interest you</li>
              <li>Discover exciting projects and collaborations</li>
              <li>Attend events and networking opportunities</li>
            </ul>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{appUrl}}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px;">Get Started</a>
            </div>
            <p>If you have any questions, feel free to reach out to our support team.</p>
            <p>Best regards,<br>The Network-X Team</p>
          </div>
        </body>
      </html>
    `,
    textPart: `
      Welcome to Network-X!
      
      Hello {{firstName}}!
      
      We're excited to have you join the Network-X community. Your account has been successfully created.
      
      Here's what you can do next:
      - Complete your profile to connect with like-minded people
      - Join clubs and communities that interest you
      - Discover exciting projects and collaborations
      - Attend events and networking opportunities
      
      Get started: {{appUrl}}
      
      If you have any questions, feel free to reach out to our support team.
      
      Best regards,
      The Network-X Team
    `
  },
  
  PASSWORD_RESET: {
    name: 'NetworkXPasswordReset',
    subject: 'Reset Your Network-X Password',
    htmlPart: `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f8f9fa; padding: 40px; text-align: center;">
            <h1 style="color: #333; margin: 0;">Password Reset Request</h1>
          </div>
          <div style="padding: 40px;">
            <h2>Hello {{firstName}}!</h2>
            <p>We received a request to reset your Network-X password. If you didn't make this request, you can safely ignore this email.</p>
            <p>To reset your password, click the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{resetUrl}}" style="background: #dc3545; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px;">Reset Password</a>
            </div>
            <p>This link will expire in 1 hour for security reasons.</p>
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">{{resetUrl}}</p>
            <p>Best regards,<br>The Network-X Team</p>
          </div>
        </body>
      </html>
    `,
    textPart: `
      Password Reset Request
      
      Hello {{firstName}}!
      
      We received a request to reset your Network-X password. If you didn't make this request, you can safely ignore this email.
      
      To reset your password, visit this link: {{resetUrl}}
      
      This link will expire in 1 hour for security reasons.
      
      Best regards,
      The Network-X Team
    `
  },
  
  NOTIFICATION_DIGEST: {
    name: 'NetworkXNotificationDigest',
    subject: 'Your Network-X Activity Summary',
    htmlPart: `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0;">Activity Summary</h1>
          </div>
          <div style="padding: 40px;">
            <h2>Hello {{firstName}}!</h2>
            <p>Here's what's been happening in your Network-X community:</p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #667eea;">📬 New Notifications</h3>
              <p>You have {{notificationCount}} new notifications waiting for you.</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #667eea;">🤝 New Connections</h3>
              <p>{{connectionCount}} people started following you this week.</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #667eea;">🚀 Project Updates</h3>
              <p>{{projectCount}} projects you're following have new updates.</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{appUrl}}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px;">View All Activity</a>
            </div>
            
            <p style="font-size: 12px; color: #666;">
              You're receiving this because you have email notifications enabled. 
              <a href="{{unsubscribeUrl}}">Unsubscribe</a> or <a href="{{settingsUrl}}">manage your preferences</a>.
            </p>
          </div>
        </body>
      </html>
    `,
    textPart: `
      Activity Summary
      
      Hello {{firstName}}!
      
      Here's what's been happening in your Network-X community:
      
      📬 New Notifications: You have {{notificationCount}} new notifications waiting for you.
      🤝 New Connections: {{connectionCount}} people started following you this week.
      🚀 Project Updates: {{projectCount}} projects you're following have new updates.
      
      View all activity: {{appUrl}}
      
      You're receiving this because you have email notifications enabled.
      Unsubscribe: {{unsubscribeUrl}}
      Manage preferences: {{settingsUrl}}
    `
  }
};

module.exports = {
  sendEmail,
  sendBulkEmail,
  sendTemplatedEmail,
  createEmailTemplate,
  verifyEmailAddress,
  getSendingStatistics,
  checkSESConfiguration,
  EMAIL_TEMPLATES
};
