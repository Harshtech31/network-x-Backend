const mongoose = require('mongoose');

const userKeysSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  publicKey: {
    type: String,
    required: true
  },
  encryptedPrivateKey: {
    type: String,
    required: true
  },
  keyVersion: {
    type: Number,
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

userKeysSchema.index({ userId: 1 });

module.exports = mongoose.model('UserKeys', userKeysSchema);
