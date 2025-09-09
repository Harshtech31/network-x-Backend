# Network-X Backend

A comprehensive real-time social networking platform backend with end-to-end encryption, built with Node.js, Express, Socket.IO, MongoDB, and AWS DynamoDB.

## 🚀 Features

### Core Functionality
- **Real-time Communication**: Socket.IO with JWT authentication
- **End-to-End Encryption**: AES-256-GCM message encryption with RSA key exchange
- **Hybrid Database**: MongoDB for users, DynamoDB for scalable content
- **Redis Caching**: Performance optimization and user presence tracking
- **JWT Authentication**: Secure user authentication with bcrypt password hashing

### API Endpoints
- **Authentication**: Login, signup, password reset
- **Posts**: CRUD operations with real-time interactions
- **Projects**: Project management with collaboration features
- **Clubs**: Community management and memberships
- **Events**: Event creation and attendance tracking
- **Messages**: Encrypted messaging with real-time delivery
- **Notifications**: Real-time notification system
- **Search**: Advanced search across all content types
- **Feed**: Personalized content feed with relevance scoring

### Real-time Features
- **Messaging**: End-to-end encrypted chat with typing indicators
- **Notifications**: Real-time push notifications
- **Presence**: User online/offline status tracking
- **Interactions**: Live post likes, comments, and reactions
- **Updates**: Real-time project, club, and event updates

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Real-time**: Socket.IO
- **Databases**: MongoDB (Mongoose), AWS DynamoDB
- **Caching**: Redis
- **Authentication**: JWT, bcrypt
- **Encryption**: Node.js crypto (AES-256-GCM, RSA-2048)
- **File Storage**: AWS S3
- **Validation**: express-validator

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Harshtech31/network-x-Backend.git
   cd network-x-Backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   # Update .env with your credentials
   ```

4. **Required Environment Variables**
   ```env
   # Server
   PORT=5000
   NODE_ENV=development
   FRONTEND_URL=http://localhost:3000

   # MongoDB
   MONGODB_URI=mongodb://localhost:27017/networkx

   # JWT
   JWT_SECRET=your_jwt_secret_key_here
   JWT_EXPIRES_IN=7d

   # AWS
   AWS_ACCESS_KEY_ID=your_aws_access_key
   AWS_SECRET_ACCESS_KEY=your_aws_secret_key
   AWS_REGION=us-east-1
   AWS_S3_BUCKET_NAME=networkx-media-storage

   # DynamoDB Tables
   DYNAMODB_POSTS_TABLE=networkx-posts
   DYNAMODB_PROJECTS_TABLE=networkx-projects
   DYNAMODB_CLUBS_TABLE=networkx-clubs
   DYNAMODB_EVENTS_TABLE=networkx-events
   DYNAMODB_MESSAGES_TABLE=networkx-messages
   DYNAMODB_NOTIFICATIONS_TABLE=networkx-notifications
   DYNAMODB_COLLABORATIONS_TABLE=networkx-collaborations

   # Redis
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=

   # Socket.IO
   SOCKET_CORS_ORIGIN=http://localhost:19006
   ```

5. **Start the server**
   ```bash
   npm start
   # or for development
   npm run dev
   ```

## 🔐 Security Features

### End-to-End Encryption
- **RSA-2048**: Key exchange and conversation key encryption
- **AES-256-GCM**: Message content encryption
- **SHA-256**: Message integrity verification
- **Perfect Forward Secrecy**: Unique keys per conversation

### Authentication & Authorization
- **JWT Tokens**: Secure API authentication
- **bcrypt**: Password hashing with salt
- **Rate Limiting**: API abuse prevention
- **Input Validation**: Comprehensive request validation

## 📡 Real-time Events

### Socket.IO Events
```javascript
// Client-side usage
socket.on('message', (data) => {
  // Handle encrypted message
});

socket.on('notification', (data) => {
  // Handle real-time notification
});

socket.on('userOnline', (data) => {
  // Handle user presence
});
```

## 🗄 Database Schema

### MongoDB Collections
- **users**: User profiles and authentication
- **conversations**: Encrypted conversation metadata
- **userKeys**: RSA key pairs for encryption

### DynamoDB Tables
- **Posts**: User posts and interactions
- **Projects**: Project management data
- **Clubs**: Community information
- **Events**: Event details and attendance
- **Messages**: Encrypted message storage
- **Notifications**: User notifications
- **Collaborations**: User connections

## 🔧 API Documentation

### Authentication
```http
POST /api/auth/login
POST /api/auth/register
POST /api/auth/forgot-password
```

### Encryption Keys
```http
POST /api/keys/generate
GET /api/keys/public/:userId
POST /api/keys/verify
```

### Messaging
```http
POST /api/messages/send
GET /api/messages/conversation/:id
GET /api/messages/conversations
```

### Real-time
```http
GET /api/realtime/status
POST /api/realtime/broadcast
GET /api/realtime/health
```

## 🚀 Deployment

### Prerequisites
- Node.js 16+
- MongoDB Atlas or local MongoDB
- Redis instance
- AWS account with DynamoDB and S3

### Production Setup
1. Set `NODE_ENV=production`
2. Configure production database URLs
3. Set up SSL certificates
4. Configure reverse proxy (nginx)
5. Set up process manager (PM2)

## 📊 Performance

- **Redis Caching**: 5-10 minute cache TTL
- **Connection Pooling**: MongoDB and DynamoDB
- **Rate Limiting**: 100 requests per 15 minutes
- **Compression**: gzip middleware
- **Security Headers**: Helmet.js

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request



## 🔗 Related Projects

- [Network-X Frontend](https://github.com/Harshtech31/Network-x-NoDevBuild) - React Native mobile app



**Built with ❤️ by the Network-X Team**
