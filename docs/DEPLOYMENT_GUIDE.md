# Network-X Backend Deployment Guide

## 🚀 Complete Setup Instructions

### Prerequisites

- **Node.js** >= 16.0.0
- **MongoDB** (Atlas or Local)
- **Redis** (Optional but recommended)
- **AWS Account** (for S3, DynamoDB, SES, SNS)

### 1. Environment Setup

Create `.env` file in the backend directory:

```env
# Server Configuration
NODE_ENV=production
PORT=5000
BASE_URL=https://your-domain.com

# Database Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/networkx
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-key-here

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# S3 Configuration
AWS_S3_BUCKET=networkx-storage

# DynamoDB Tables
DYNAMODB_POSTS_TABLE=networkx-posts
DYNAMODB_PROJECTS_TABLE=networkx-projects
DYNAMODB_CLUBS_TABLE=networkx-clubs
DYNAMODB_EVENTS_TABLE=networkx-events
DYNAMODB_MESSAGES_TABLE=networkx-messages
DYNAMODB_NOTIFICATIONS_TABLE=networkx-notifications
DYNAMODB_COLLABORATIONS_TABLE=networkx-collaborations
DYNAMODB_REPORTS_TABLE=networkx-reports
DYNAMODB_BOOKMARKS_TABLE=networkx-bookmarks

# Email Configuration (SES)
FROM_EMAIL=noreply@your-domain.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# OpenSearch Configuration (Optional)
OPENSEARCH_ENDPOINT=https://your-opensearch-domain.region.es.amazonaws.com
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=your-password

# Frontend Configuration
FRONTEND_URL=https://your-frontend-domain.com
```

### 2. Database Setup

#### MongoDB Setup
1. Create MongoDB Atlas cluster or install locally
2. Create database user with read/write permissions
3. Add your server IP to whitelist
4. Copy connection string to `MONGODB_URI`

#### DynamoDB Setup
Run the initialization script:
```bash
cd backend
node src/scripts/init-dynamodb.js create
```

#### Redis Setup (Optional)
- Use Redis Cloud, AWS ElastiCache, or local Redis
- Update Redis configuration in `.env`

### 3. AWS Services Configuration

#### S3 Bucket Setup
```bash
# Create S3 bucket
aws s3 mb s3://networkx-storage

# Set bucket policy for public read access
aws s3api put-bucket-policy --bucket networkx-storage --policy file://bucket-policy.json
```

Create `bucket-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::networkx-storage/networkx/*"
    }
  ]
}
```

#### IAM User Setup
Create IAM user with these policies:
- `AmazonS3FullAccess`
- `AmazonDynamoDBFullAccess`
- `AmazonSESFullAccess`
- `AmazonSNSFullAccess`
- `AmazonOpenSearchServiceFullAccess`

### 4. Installation and Deployment

#### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Initialize DynamoDB tables
node src/scripts/init-dynamodb.js create
```

#### Production Deployment

##### Option 1: PM2 (Recommended)
```bash
# Install PM2 globally
npm install -g pm2

# Install dependencies
npm install --production

# Start with PM2
pm2 start server.js --name "networkx-backend"

# Save PM2 configuration
pm2 save
pm2 startup
```

##### Option 2: Docker
Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t networkx-backend .
docker run -p 5000:5000 --env-file .env networkx-backend
```

##### Option 3: AWS ECS/Fargate
1. Push Docker image to ECR
2. Create ECS cluster and task definition
3. Deploy using Fargate or EC2

### 5. Health Checks and Monitoring

#### Health Check Endpoints
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status (admin only)
- `GET /health/db` - Database connectivity test
- `GET /health/services` - AWS services status

#### Monitoring Setup
```bash
# Check system health
curl https://your-domain.com/health

# Check detailed health (requires admin token)
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     https://your-domain.com/health/detailed
```

### 6. Security Configuration

#### SSL/TLS Setup
Use Let's Encrypt with Nginx:
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Firewall Configuration
```bash
# Allow only necessary ports
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

### 7. Performance Optimization

#### Database Indexes
Indexes are automatically created by the User model. For production, consider:
```javascript
// Additional compound indexes for better performance
db.users.createIndex({ "department": 1, "year": 1, "isActive": 1 })
db.users.createIndex({ "skills": 1, "isActive": 1 })
db.users.createIndex({ "location": 1, "isActive": 1 })
```

#### Redis Caching
Ensure Redis is properly configured for production:
```bash
# Redis configuration for production
maxmemory 256mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### 8. Backup and Recovery

#### MongoDB Backup
```bash
# Create backup
mongodump --uri="mongodb+srv://username:password@cluster.mongodb.net/networkx" --out=./backup

# Restore backup
mongorestore --uri="mongodb+srv://username:password@cluster.mongodb.net/networkx" ./backup/networkx
```

#### DynamoDB Backup
Enable point-in-time recovery in AWS Console or use:
```bash
aws dynamodb put-backup-policy --table-name networkx-posts --backup-policy BackupEnabled=true
```

### 9. Troubleshooting

#### Common Issues

**MongoDB Connection Failed**
```bash
# Check connection string
node -e "console.log(process.env.MONGODB_URI)"

# Test connection
node src/scripts/test-setup.js
```

**DynamoDB Access Denied**
- Verify AWS credentials
- Check IAM permissions
- Ensure region is correct

**Redis Connection Issues**
- Check Redis server status
- Verify host/port configuration
- Test with Redis CLI: `redis-cli ping`

**File Upload Issues**
- Verify S3 bucket permissions
- Check AWS credentials
- Ensure bucket policy allows public read

#### Logs and Debugging
```bash
# View PM2 logs
pm2 logs networkx-backend

# View system logs
tail -f /var/log/syslog

# Enable debug mode
DEBUG=* npm start
```

### 10. API Documentation

#### Admin Endpoints
- `GET /api/admin/users` - Manage users
- `GET /api/admin/reports` - Content moderation
- `GET /api/admin/content/:type` - Content management

#### Analytics Endpoints
- `GET /api/analytics/dashboard` - System analytics
- `GET /api/analytics/users` - User statistics
- `GET /api/analytics/my-stats` - Personal statistics

#### Health Monitoring
- `GET /health/metrics` - Performance metrics
- `GET /health/services` - Service status

### 11. Scaling Considerations

#### Horizontal Scaling
- Use load balancer (Nginx, AWS ALB)
- Enable Redis for session sharing
- Use MongoDB replica sets
- Implement DynamoDB auto-scaling

#### Performance Monitoring
- Set up CloudWatch alarms
- Monitor API response times
- Track database performance
- Monitor memory and CPU usage

### 12. Maintenance

#### Regular Tasks
- Update dependencies: `npm audit fix`
- Monitor disk space
- Review logs for errors
- Update SSL certificates
- Backup databases

#### Security Updates
- Keep Node.js updated
- Update npm packages regularly
- Monitor security advisories
- Review access logs

---

## 🎉 Deployment Complete!

Your Network-X backend is now ready for production. Monitor the health endpoints and logs to ensure everything is running smoothly.

For support, check the troubleshooting section or review the application logs.
