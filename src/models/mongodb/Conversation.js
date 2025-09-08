const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    unique: true
  },
  participants: [{
    userId: {
      type: String,
      required: true
    },
    encryptedKey: {
      type: String,
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  conversationType: {
    type: String,
    enum: ['direct', 'group'],
    default: 'direct'
  },
  isEncrypted: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: String,
    required: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  metadata: {
    name: String,
    description: String,
    avatar: String
  }
}, {
  timestamps: true
});

conversationSchema.index({ conversationId: 1 });
conversationSchema.index({ 'participants.userId': 1 });
conversationSchema.index({ lastActivity: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
