const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { putItem, getItem, scanItems, updateItem, deleteItem, queryItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS } = require('../config/redis');
const User = require('../models/mongodb/User');
const Conversation = require('../models/mongodb/Conversation');
const UserKeys = require('../models/mongodb/UserKeys');
const RealtimeService = require('../services/realtime');
const EncryptionService = require('../services/encryption');

const router = express.Router();
const MESSAGES_TABLE = process.env.DYNAMODB_MESSAGES_TABLE || 'networkx-messages';

// GET /api/messages/conversations - Get user's conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.id;
    const cacheKey = CACHE_KEYS.CONVERSATIONS(userId);
    
    // Try cache first
    const cachedConversations = await getCache(cacheKey);
    if (cachedConversations) {
      return res.json(cachedConversations);
    }

    // Get all messages where user is sender or receiver
    const allMessages = await scanItems(MESSAGES_TABLE);
    const userMessages = allMessages.filter(message => 
      message.senderId === userId || message.receiverId === userId
    );

    // Group messages by conversation
    const conversationsMap = new Map();
    
    for (const message of userMessages) {
      const conversationId = message.conversationId;
      if (!conversationsMap.has(conversationId)) {
        conversationsMap.set(conversationId, {
          conversationId,
          participants: new Set(),
          lastMessage: message,
          unreadCount: 0,
          messages: []
        });
      }
      
      const conversation = conversationsMap.get(conversationId);
      conversation.participants.add(message.senderId);
      conversation.participants.add(message.receiverId);
      conversation.messages.push(message);
      
      // Update last message if this one is newer
      if (new Date(message.timestamp) > new Date(conversation.lastMessage.timestamp)) {
        conversation.lastMessage = message;
      }
      
      // Count unread messages
      if (message.receiverId === userId && !message.isRead) {
        conversation.unreadCount++;
      }
    }

    // Convert to array and get participant details
    const conversations = await Promise.all(
      Array.from(conversationsMap.values()).map(async (conversation) => {
        const participantIds = Array.from(conversation.participants).filter(id => id !== userId);
        const participants = await Promise.all(
          participantIds.map(async (participantId) => {
            const user = await User.findById(participantId).select('firstName lastName username profileImage');
            return user;
          })
        );
        
        // Get sender details for last message
        const lastMessageSender = await User.findById(conversation.lastMessage.senderId)
          .select('firstName lastName username profileImage');
        
        return {
          conversationId: conversation.conversationId,
          participants: participants.filter(p => p !== null),
          lastMessage: {
            ...conversation.lastMessage,
            sender: lastMessageSender
          },
          unreadCount: conversation.unreadCount,
          updatedAt: conversation.lastMessage.timestamp
        };
      })
    );

    // Sort by last message timestamp
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const result = {
      conversations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: conversations.length
      }
    };

    // Cache for 2 minutes
    await setCache(cacheKey, result, 120);
    
    res.json(result);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /api/messages/:conversationId - Get messages in a conversation
router.get('/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id;
    const cacheKey = CACHE_KEYS.CONVERSATION_MESSAGES(conversationId, page);
    
    // Try cache first
    const cachedMessages = await getCache(cacheKey);
    if (cachedMessages) {
      return res.json(cachedMessages);
    }

    // Get messages for this conversation
    const messages = await queryItems(
      MESSAGES_TABLE,
      'conversationId = :conversationId',
      { ':conversationId': conversationId },
      null,
      parseInt(limit)
    );

    // Check if user is participant in this conversation
    const userMessages = messages.filter(message => 
      message.senderId === userId || message.receiverId === userId
    );
    
    if (userMessages.length === 0 && messages.length > 0) {
      return res.status(403).json({ error: 'Not authorized to view this conversation' });
    }

    // Get sender details for each message
    const messagesWithSenders = await Promise.all(
      messages.map(async (message) => {
        const sender = await User.findById(message.senderId).select('firstName lastName username profileImage');
        return {
          ...message,
          sender
        };
      })
    );

    // Sort by timestamp (oldest first)
    messagesWithSenders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const result = {
      messages: messagesWithSenders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: messagesWithSenders.length
      }
    };

    // Cache for 1 minute
    await setCache(cacheKey, result, 60);
    
    res.json(result);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages/send - Send an encrypted message
router.post('/send', authenticateToken, [
  body('receiverId').notEmpty().withMessage('Receiver ID is required'),
  body('content').notEmpty().withMessage('Message content is required'),
  body('type').optional().isIn(['text', 'image', 'file']).withMessage('Invalid message type')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { receiverId, content, type = 'text', metadata = {} } = req.body;
    const senderId = req.user.id;

    // Check if receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        error: 'User not found',
        message: 'Receiver does not exist'
      });
    }

    const conversationId = [senderId, receiverId].sort().join('_');
    
    // Get or create conversation with encryption
    let conversation = await Conversation.findOne({ conversationId });
    if (!conversation) {
      // Generate new conversation key
      const conversationKey = EncryptionService.generateConversationKey();
      
      // Get public keys for both users
      const senderKeys = await UserKeys.findOne({ userId: senderId });
      const receiverKeys = await UserKeys.findOne({ userId: receiverId });
      
      if (!senderKeys || !receiverKeys) {
        return res.status(400).json({
          error: 'Encryption keys not found',
          message: 'Both users must have encryption keys set up'
        });
      }
      
      // Encrypt conversation key for both users
      const senderEncryptedKey = EncryptionService.encryptKeyForUser(conversationKey, senderKeys.publicKey);
      const receiverEncryptedKey = EncryptionService.encryptKeyForUser(conversationKey, receiverKeys.publicKey);
      
      conversation = new Conversation({
        conversationId,
        participants: [
          { userId: senderId, encryptedKey: senderEncryptedKey },
          { userId: receiverId, encryptedKey: receiverEncryptedKey }
        ],
        conversationType: 'direct',
        createdBy: senderId,
        isEncrypted: true
      });
      
      await conversation.save();
    }

    // Get sender's encrypted conversation key and decrypt it
    const senderParticipant = conversation.participants.find(p => p.userId === senderId);
    const senderKeys = await UserKeys.findOne({ userId: senderId });
    
    // For demo purposes, we'll use a simplified encryption approach
    // In production, you'd decrypt the private key with user's password
    const conversationKey = EncryptionService.decryptKeyForUser(
      senderParticipant.encryptedKey, 
      senderKeys.encryptedPrivateKey // This should be decrypted with user's password
    );

    // Encrypt the message content
    const encryptedMessage = EncryptionService.encryptMessage(content, conversationKey);
    
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    // Generate message hash for integrity
    const messageHash = EncryptionService.generateMessageHash(content, timestamp, senderId);

    const messageData = {
      messageId,
      conversationId,
      senderId,
      receiverId,
      encryptedContent: encryptedMessage.encryptedContent,
      iv: encryptedMessage.iv,
      tag: encryptedMessage.tag,
      messageHash,
      type,
      metadata,
      timestamp,
      isRead: false,
      isDelivered: false,
      isEncrypted: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Save encrypted message to DynamoDB
    await putItem(MESSAGES_TABLE, messageData);

    // Update conversation last activity
    conversation.lastActivity = new Date();
    await conversation.save();

    // Cache recent messages
    const cacheKey = CACHE_KEYS.CONVERSATION_MESSAGES(conversationId);
    await deleteCache(cacheKey);

    // Get sender details for real-time notification
    const sender = await User.findById(senderId).select('firstName lastName username profileImage');

    // Emit real-time message event (content is encrypted)
    await RealtimeService.sendMessage({
      messageId,
      conversationId,
      senderId,
      receiverId,
      encryptedContent: encryptedMessage.encryptedContent,
      iv: encryptedMessage.iv,
      tag: encryptedMessage.tag,
      type,
      timestamp,
      isEncrypted: true,
      sender: {
        id: senderId,
        name: `${sender.firstName} ${sender.lastName}`,
        username: sender.username,
        profileImage: sender.profileImage
      }
    });

    // Send notification to receiver
    await RealtimeService.sendNotification(receiverId, {
      type: 'message',
      title: 'New Message',
      message: `${sender.firstName} ${sender.lastName} sent you an encrypted message`,
      data: {
        messageId,
        conversationId,
        senderId,
        senderName: `${sender.firstName} ${sender.lastName}`,
        isEncrypted: true
      },
      timestamp
    });

    res.status(201).json({
      message: 'Encrypted message sent successfully',
      data: {
        messageId,
        conversationId,
        timestamp,
        isEncrypted: true
      }
    });

  } catch (error) {
    console.error('Send encrypted message error:', error);
    res.status(500).json({
      error: 'Failed to send encrypted message',
      message: 'An error occurred while sending the encrypted message'
    });
  }
});

// POST /api/messages - Send a new message
const { uploadMiddleware } = require('../config/aws');
router.post('/', authenticateToken, uploadMiddleware.messageMedia, async (req, res) => {
  try {
    const { receiverId, content, conversationId } = req.body;
    const senderId = req.user.id;
    
    if (!receiverId) {
      return res.status(400).json({ error: 'Receiver ID is required' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Check if receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'Receiver not found' });
    }

    const messageId = uuidv4();
    const finalConversationId = conversationId || uuidv4();
    const mediaUrls = req.files ? req.files.map(file => file.location) : [];
    
    const message = {
      messageId,
      conversationId: finalConversationId,
      senderId,
      receiverId,
      content: content.trim(),
      mediaUrls,
      messageType: mediaUrls.length > 0 ? 'media' : 'text',
      isRead: false,
      isDelivered: false,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(MESSAGES_TABLE, message);

    // Get sender details
    const sender = await User.findById(senderId).select('firstName lastName username profileImage');
    
    const responseMessage = {
      ...message,
      sender
    };

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CONVERSATIONS(senderId));
    await deleteCache(CACHE_KEYS.CONVERSATIONS(receiverId));
    await deleteCache(CACHE_KEYS.CONVERSATION_MESSAGES(finalConversationId, 1));

    // Send real-time message
    await RealtimeService.handleMessageInteraction(
      finalConversationId,
      'new_message',
      req.user,
      {
        receiverId,
        content: content.trim(),
        messageType: mediaUrls.length > 0 ? 'media' : 'text'
      }
    );

    res.status(201).json({
      message: 'Message sent successfully',
      data: responseMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PUT /api/messages/:messageId/read - Mark message as read
router.put('/:messageId/read', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    // Get the message first
    const messages = await scanItems(MESSAGES_TABLE, 'messageId = :messageId', { ':messageId': messageId });
    const message = messages.find(m => m.messageId === messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.receiverId !== userId) {
      return res.status(403).json({ error: 'Not authorized to mark this message as read' });
    }

    if (message.isRead) {
      return res.status(400).json({ error: 'Message already marked as read' });
    }

    const updateExpression = 'SET isRead = :isRead, readAt = :readAt, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':isRead': true,
      ':readAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString()
    };

    await updateItem(
      MESSAGES_TABLE,
      { conversationId: message.conversationId, messageId },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CONVERSATIONS(userId));
    await deleteCache(CACHE_KEYS.CONVERSATION_MESSAGES(message.conversationId, 1));

    // Send real-time read receipt
    await RealtimeService.handleMessageInteraction(
      message.conversationId,
      'message_read',
      req.user,
      {
        messageId,
        senderId: message.senderId
      }
    );

    res.json({ message: 'Message marked as read' });
  } catch (error) {
    console.error('Mark message as read error:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// DELETE /api/messages/:messageId - Delete a message
router.delete('/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    // Get the message first
    const messages = await scanItems(MESSAGES_TABLE, 'messageId = :messageId', { ':messageId': messageId });
    const message = messages.find(m => m.messageId === messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    await deleteItem(MESSAGES_TABLE, { conversationId: message.conversationId, messageId });

    // Invalidate cache
    await deleteCache(CACHE_KEYS.CONVERSATIONS(userId));
    await deleteCache(CACHE_KEYS.CONVERSATIONS(message.receiverId));
    await deleteCache(CACHE_KEYS.CONVERSATION_MESSAGES(message.conversationId, 1));

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /api/messages/conversations/:conversationId/typing - Send typing indicator
router.post('/conversations/:conversationId/typing', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { isTyping = true } = req.body;
    const userId = req.user.id;
    
    // Verify user is part of this conversation
    const messages = await queryItems(
      MESSAGES_TABLE,
      'conversationId = :conversationId',
      { ':conversationId': conversationId },
      null,
      1
    );
    
    const userMessage = messages.find(message => 
      message.senderId === userId || message.receiverId === userId
    );
    
    if (!userMessage) {
      return res.status(403).json({ error: 'Not authorized to access this conversation' });
    }

    // In a real implementation, this would emit a socket event
    // For now, we'll just return success
    res.json({ 
      message: 'Typing indicator sent',
      conversationId,
      userId,
      isTyping
    });
  } catch (error) {
    console.error('Typing indicator error:', error);
    res.status(500).json({ error: 'Failed to send typing indicator' });
  }
});

module.exports = router;
