const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');

class FallbackService {
  constructor() {
    this.awsAvailable = {
      s3: false,
      ses: false,
      sns: false,
      dynamodb: false,
      opensearch: false
    };
    this.localStoragePath = path.join(__dirname, '../../storage');
    this.initializeLocalStorage();
  }

  async initializeLocalStorage() {
    try {
      await fs.mkdir(this.localStoragePath, { recursive: true });
      await fs.mkdir(path.join(this.localStoragePath, 'uploads'), { recursive: true });
      await fs.mkdir(path.join(this.localStoragePath, 'backups'), { recursive: true });
      console.log('✅ Local storage initialized');
    } catch (error) {
      console.error('❌ Failed to initialize local storage:', error);
    }
  }

  // S3 Fallback - Local File Storage
  async uploadFile(file, key) {
    if (this.awsAvailable.s3) {
      // Use actual S3 upload
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3();
      try {
        const result = await s3.upload({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'public-read'
        }).promise();
        return result.Location;
      } catch (error) {
        console.warn('S3 upload failed, falling back to local storage:', error.message);
        this.awsAvailable.s3 = false;
      }
    }

    // Fallback to local storage
    try {
      const fileName = `${Date.now()}_${key.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = path.join(this.localStoragePath, 'uploads', fileName);
      
      await fs.writeFile(filePath, file.buffer);
      
      const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
      return `${baseUrl}/uploads/${fileName}`;
    } catch (error) {
      console.error('Local file storage failed:', error);
      throw new Error('File upload failed');
    }
  }

  async deleteFile(fileUrl) {
    if (fileUrl.includes('amazonaws.com') && this.awsAvailable.s3) {
      // Delete from S3
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3();
      try {
        const key = fileUrl.split('/').pop();
        await s3.deleteObject({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: key
        }).promise();
        return true;
      } catch (error) {
        console.warn('S3 delete failed:', error.message);
      }
    }

    // Delete from local storage
    try {
      const fileName = fileUrl.split('/').pop();
      const filePath = path.join(this.localStoragePath, 'uploads', fileName);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error('Local file delete failed:', error);
      return false;
    }
  }

  // SES Fallback - SMTP Email
  async sendEmail(params) {
    if (this.awsAvailable.ses) {
      // Use actual SES
      const AWS = require('aws-sdk');
      const ses = new AWS.SES();
      try {
        const result = await ses.sendEmail({
          Source: params.from || process.env.FROM_EMAIL,
          Destination: { ToAddresses: [params.to] },
          Message: {
            Subject: { Data: params.subject },
            Body: {
              Html: { Data: params.html || params.text },
              Text: { Data: params.text }
            }
          }
        }).promise();
        return result;
      } catch (error) {
        console.warn('SES email failed, falling back to SMTP:', error.message);
        this.awsAvailable.ses = false;
      }
    }

    // Fallback to SMTP
    try {
      const transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      const result = await transporter.sendMail({
        from: params.from || process.env.FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html
      });

      return result;
    } catch (error) {
      console.error('SMTP email failed:', error);
      // Log email to file as last resort
      await this.logEmailToFile(params);
      throw new Error('Email delivery failed');
    }
  }

  async logEmailToFile(params) {
    try {
      const emailLog = {
        timestamp: new Date().toISOString(),
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html
      };
      
      const logPath = path.join(this.localStoragePath, 'email_log.json');
      let logs = [];
      
      try {
        const existingLogs = await fs.readFile(logPath, 'utf8');
        logs = JSON.parse(existingLogs);
      } catch (error) {
        // File doesn't exist or is empty
      }
      
      logs.push(emailLog);
      await fs.writeFile(logPath, JSON.stringify(logs, null, 2));
      console.log('📧 Email logged to file:', params.to);
    } catch (error) {
      console.error('Failed to log email to file:', error);
    }
  }

  // SNS Fallback - In-App Notifications Only
  async sendPushNotification(params) {
    if (this.awsAvailable.sns) {
      // Use actual SNS
      const AWS = require('aws-sdk');
      const sns = new AWS.SNS();
      try {
        const result = await sns.publish({
          TopicArn: params.topicArn,
          Message: JSON.stringify({
            default: params.message,
            GCM: JSON.stringify({
              data: {
                title: params.title,
                body: params.message,
                ...params.data
              }
            }),
            APNS: JSON.stringify({
              aps: {
                alert: {
                  title: params.title,
                  body: params.message
                },
                badge: 1,
                sound: 'default'
              },
              ...params.data
            })
          }),
          MessageStructure: 'json'
        }).promise();
        return result;
      } catch (error) {
        console.warn('SNS push notification failed, using in-app only:', error.message);
        this.awsAvailable.sns = false;
      }
    }

    // Fallback to in-app notification only
    console.log('📱 Push notification fallback - in-app only:', {
      title: params.title,
      message: params.message,
      userId: params.userId
    });
    
    return { fallback: true, method: 'in-app-only' };
  }

  // OpenSearch Fallback - Database Search
  async searchContent(query, filters = {}) {
    if (this.awsAvailable.opensearch) {
      // Use actual OpenSearch
      try {
        const { Client } = require('@opensearch-project/opensearch');
        const client = new Client({
          node: process.env.OPENSEARCH_ENDPOINT,
          auth: {
            username: process.env.OPENSEARCH_USERNAME,
            password: process.env.OPENSEARCH_PASSWORD
          }
        });

        const searchParams = {
          index: 'networkx-content',
          body: {
            query: {
              multi_match: {
                query: query,
                fields: ['title^2', 'content', 'description', 'tags']
              }
            },
            ...filters
          }
        };

        const result = await client.search(searchParams);
        return result.body.hits.hits.map(hit => hit._source);
      } catch (error) {
        console.warn('OpenSearch failed, falling back to database search:', error.message);
        this.awsAvailable.opensearch = false;
      }
    }

    // Fallback to database search
    return this.databaseSearch(query, filters);
  }

  async databaseSearch(query, filters = {}) {
    const User = require('../models/mongodb/User');
    const { scanItems } = require('../config/dynamodb');
    
    const results = {
      users: [],
      posts: [],
      projects: [],
      clubs: [],
      events: []
    };

    try {
      // Search users in MongoDB
      if (!filters.type || filters.type === 'users') {
        results.users = await User.find({
          $text: { $search: query },
          isActive: true
        }).select('firstName lastName username profileImage department year')
          .limit(20);
      }

      // Search content in DynamoDB tables
      const contentTypes = ['posts', 'projects', 'clubs', 'events'];
      
      for (const type of contentTypes) {
        if (filters.type && filters.type !== type) continue;
        
        try {
          const tableName = process.env[`DYNAMODB_${type.toUpperCase()}_TABLE`] || `networkx-${type}`;
          const items = await scanItems(tableName);
          
          results[type] = items.filter(item => {
            const searchFields = [
              item.title,
              item.content,
              item.description,
              item.name,
              ...(item.tags || [])
            ].filter(Boolean).join(' ').toLowerCase();
            
            return searchFields.includes(query.toLowerCase());
          }).slice(0, 20);
        } catch (error) {
          console.error(`Database search failed for ${type}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Database search failed:', error);
      return results;
    }
  }

  // Health check for AWS services
  async checkAWSServices() {
    const AWS = require('aws-sdk');
    
    // Check S3
    try {
      const s3 = new AWS.S3();
      await s3.headBucket({ Bucket: process.env.AWS_S3_BUCKET }).promise();
      this.awsAvailable.s3 = true;
    } catch (error) {
      this.awsAvailable.s3 = false;
    }

    // Check SES
    try {
      const ses = new AWS.SES();
      await ses.getSendQuota().promise();
      this.awsAvailable.ses = true;
    } catch (error) {
      this.awsAvailable.ses = false;
    }

    // Check SNS
    try {
      const sns = new AWS.SNS();
      await sns.listTopics().promise();
      this.awsAvailable.sns = true;
    } catch (error) {
      this.awsAvailable.sns = false;
    }

    // Check DynamoDB
    try {
      const dynamodb = new AWS.DynamoDB();
      await dynamodb.listTables({ Limit: 1 }).promise();
      this.awsAvailable.dynamodb = true;
    } catch (error) {
      this.awsAvailable.dynamodb = false;
    }

    console.log('AWS Services Status:', this.awsAvailable);
    return this.awsAvailable;
  }

  getServiceStatus() {
    return this.awsAvailable;
  }
}

module.exports = new FallbackService();
