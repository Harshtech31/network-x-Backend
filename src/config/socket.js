const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { connectRedis, redisClient } = require('./redis');
const User = require('../models/mongodb/User');
const { createNotification } = require('../routes/notifications');

let io = null;
const connectedUsers = new Map(); // userId -> socketId mapping
const userSockets = new Map(); // socketId -> userId mapping

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`🔗 User ${userId} connected via socket: ${socket.id}`);

    // Store user connection
    connectedUsers.set(userId, socket.id);
    userSockets.set(socket.id, userId);

    // Join user to their personal room for notifications
    socket.join(`user:${userId}`);

    // Emit online status
    socket.broadcast.emit('user:online', { userId });

    // Handle joining conversation rooms
    socket.on('conversation:join', (conversationId) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`📱 User ${userId} joined conversation: ${conversationId}`);
    });

    // Handle leaving conversation rooms
    socket.on('conversation:leave', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`📱 User ${userId} left conversation: ${conversationId}`);
    });

    // Handle typing indicators
    socket.on('typing:start', (data) => {
      const { conversationId } = data;
      socket.to(`conversation:${conversationId}`).emit('typing:start', {
        userId,
        conversationId,
        user: {
          id: socket.user._id,
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          username: socket.user.username
        }
      });
    });

    socket.on('typing:stop', (data) => {
      const { conversationId } = data;
      socket.to(`conversation:${conversationId}`).emit('typing:stop', {
        userId,
        conversationId
      });
    });

    // Handle new messages
    socket.on('message:send', async (data) => {
      try {
        const { conversationId, receiverId, content, messageType = 'text' } = data;
        
        // Emit to conversation room
        socket.to(`conversation:${conversationId}`).emit('message:new', {
          conversationId,
          senderId: userId,
          receiverId,
          content,
          messageType,
          timestamp: new Date().toISOString(),
          sender: {
            id: socket.user._id,
            firstName: socket.user.firstName,
            lastName: socket.user.lastName,
            username: socket.user.username,
            profileImage: socket.user.profileImage
          }
        });

        // Send notification to receiver if they're online
        if (connectedUsers.has(receiverId)) {
          io.to(`user:${receiverId}`).emit('notification:new', {
            type: 'message',
            title: 'New Message',
            message: `${socket.user.firstName} sent you a message`,
            data: { conversationId, senderId: userId }
          });
        }

        console.log(`💬 Message sent in conversation ${conversationId}`);
      } catch (error) {
        console.error('Message send error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle message read receipts
    socket.on('message:read', (data) => {
      const { conversationId, messageId, senderId } = data;
      
      // Notify sender that message was read
      if (connectedUsers.has(senderId)) {
        io.to(`user:${senderId}`).emit('message:read', {
          conversationId,
          messageId,
          readBy: userId,
          readAt: new Date().toISOString()
        });
      }
    });

    // Handle post interactions
    socket.on('post:like', (data) => {
      const { postId, postOwnerId, liked } = data;
      
      // Notify post owner
      if (postOwnerId !== userId && connectedUsers.has(postOwnerId)) {
        io.to(`user:${postOwnerId}`).emit('notification:new', {
          type: 'like',
          title: liked ? 'New Like' : 'Like Removed',
          message: `${socket.user.firstName} ${liked ? 'liked' : 'unliked'} your post`,
          data: { postId, userId }
        });
      }

      // Broadcast to followers/friends (implement based on your social graph)
      socket.broadcast.emit('post:interaction', {
        type: 'like',
        postId,
        userId,
        liked
      });
    });

    socket.on('post:comment', (data) => {
      const { postId, postOwnerId, comment } = data;
      
      // Notify post owner
      if (postOwnerId !== userId && connectedUsers.has(postOwnerId)) {
        io.to(`user:${postOwnerId}`).emit('notification:new', {
          type: 'comment',
          title: 'New Comment',
          message: `${socket.user.firstName} commented on your post`,
          data: { postId, userId, comment }
        });
      }
    });

    // Handle project interactions
    socket.on('project:apply', (data) => {
      const { projectId, projectOwnerId } = data;
      
      // Notify project owner
      if (connectedUsers.has(projectOwnerId)) {
        io.to(`user:${projectOwnerId}`).emit('notification:new', {
          type: 'project_application',
          title: 'New Project Application',
          message: `${socket.user.firstName} applied to join your project`,
          data: { projectId, applicantId: userId }
        });
      }
    });

    socket.on('project:invite', (data) => {
      const { projectId, inviteeId } = data;
      
      // Notify invitee
      if (connectedUsers.has(inviteeId)) {
        io.to(`user:${inviteeId}`).emit('notification:new', {
          type: 'project_invite',
          title: 'Project Invitation',
          message: `${socket.user.firstName} invited you to join a project`,
          data: { projectId, inviterId: userId }
        });
      }
    });

    // Handle club interactions
    socket.on('club:join', (data) => {
      const { clubId, clubPresidentId } = data;
      
      // Notify club president
      if (connectedUsers.has(clubPresidentId)) {
        io.to(`user:${clubPresidentId}`).emit('notification:new', {
          type: 'club_join',
          title: 'New Club Member',
          message: `${socket.user.firstName} joined your club`,
          data: { clubId, memberId: userId }
        });
      }
    });

    // Handle event interactions
    socket.on('event:attend', (data) => {
      const { eventId, eventOrganizerId, attending } = data;
      
      // Notify event organizer
      if (eventOrganizerId !== userId && connectedUsers.has(eventOrganizerId)) {
        io.to(`user:${eventOrganizerId}`).emit('notification:new', {
          type: 'event_attendance',
          title: attending ? 'New Event Attendee' : 'Event Attendance Cancelled',
          message: `${socket.user.firstName} ${attending ? 'will attend' : 'cancelled attendance for'} your event`,
          data: { eventId, attendeeId: userId, attending }
        });
      }
    });

    // Handle follow/connection requests
    socket.on('user:follow', (data) => {
      const { followedUserId } = data;
      
      // Notify followed user
      if (connectedUsers.has(followedUserId)) {
        io.to(`user:${followedUserId}`).emit('notification:new', {
          type: 'follow',
          title: 'New Follower',
          message: `${socket.user.firstName} started following you`,
          data: { followerId: userId }
        });
      }
    });

    socket.on('user:connect', (data) => {
      const { targetUserId } = data;
      
      // Notify target user
      if (connectedUsers.has(targetUserId)) {
        io.to(`user:${targetUserId}`).emit('notification:new', {
          type: 'connection_request',
          title: 'Connection Request',
          message: `${socket.user.firstName} wants to connect with you`,
          data: { requesterId: userId }
        });
      }
    });

    // Handle general notifications
    socket.on('notification:send', async (data) => {
      try {
        const { targetUserId, type, title, message, data: notificationData } = data;
        
        // Create notification in database
        await createNotification({
          userId: targetUserId,
          senderId: userId,
          type,
          title,
          message,
          data: notificationData || {}
        });

        // Send real-time notification if user is online
        if (connectedUsers.has(targetUserId)) {
          io.to(`user:${targetUserId}`).emit('notification:new', {
            type,
            title,
            message,
            data: notificationData,
            sender: {
              id: socket.user._id,
              firstName: socket.user.firstName,
              lastName: socket.user.lastName,
              username: socket.user.username,
              profileImage: socket.user.profileImage
            }
          });
        }
      } catch (error) {
        console.error('Send notification error:', error);
        socket.emit('error', { message: 'Failed to send notification' });
      }
    });

    // Handle presence updates
    socket.on('presence:update', (data) => {
      const { status } = data; // 'online', 'away', 'busy', 'offline'
      
      // Update user presence in Redis
      if (redisClient()) {
        redisClient().setex(`presence:${userId}`, 300, JSON.stringify({
          status,
          lastSeen: new Date().toISOString(),
          socketId: socket.id
        }));
      }

      // Broadcast presence update
      socket.broadcast.emit('presence:update', {
        userId,
        status,
        lastSeen: new Date().toISOString()
      });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`🔌 User ${userId} disconnected: ${reason}`);
      
      // Remove from connected users
      connectedUsers.delete(userId);
      userSockets.delete(socket.id);

      // Update presence to offline
      if (redisClient()) {
        redisClient().setex(`presence:${userId}`, 300, JSON.stringify({
          status: 'offline',
          lastSeen: new Date().toISOString()
        }));
      }

      // Broadcast offline status
      socket.broadcast.emit('user:offline', { 
        userId,
        lastSeen: new Date().toISOString()
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });
  });

  console.log('🚀 Socket.IO server initialized');
  return io;
};

// Helper functions
const getSocketIO = () => io;

const isUserOnline = (userId) => {
  return connectedUsers.has(userId);
};

const sendNotificationToUser = (userId, notification) => {
  if (io && connectedUsers.has(userId)) {
    io.to(`user:${userId}`).emit('notification:new', notification);
    return true;
  }
  return false;
};

const sendMessageToConversation = (conversationId, message) => {
  if (io) {
    io.to(`conversation:${conversationId}`).emit('message:new', message);
    return true;
  }
  return false;
};

const broadcastToAllUsers = (event, data) => {
  if (io) {
    io.emit(event, data);
    return true;
  }
  return false;
};

const getConnectedUsers = () => {
  return Array.from(connectedUsers.keys());
};

const getUserPresence = async (userId) => {
  if (!redisClient()) return null;
  
  try {
    const presence = await redisClient().get(`presence:${userId}`);
    return presence ? JSON.parse(presence) : null;
  } catch (error) {
    console.error('Get user presence error:', error);
    return null;
  }
};

module.exports = {
  initializeSocket,
  getSocketIO,
  isUserOnline,
  sendNotificationToUser,
  sendMessageToConversation,
  broadcastToAllUsers,
  getConnectedUsers,
  getUserPresence
};
