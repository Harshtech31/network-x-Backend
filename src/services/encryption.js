const crypto = require('crypto');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.tagLength = 16; // 128 bits
  }

  // Generate a new encryption key for a conversation
  generateConversationKey() {
    return crypto.randomBytes(this.keyLength).toString('base64');
  }

  // Generate key pair for user (for key exchange)
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    return { publicKey, privateKey };
  }

  // Encrypt conversation key with user's public key
  encryptKeyForUser(conversationKey, publicKey) {
    try {
      const buffer = Buffer.from(conversationKey, 'base64');
      const encrypted = crypto.publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        buffer
      );
      return encrypted.toString('base64');
    } catch (error) {
      console.error('Error encrypting key for user:', error);
      throw new Error('Failed to encrypt conversation key');
    }
  }

  // Decrypt conversation key with user's private key
  decryptKeyForUser(encryptedKey, privateKey) {
    try {
      const buffer = Buffer.from(encryptedKey, 'base64');
      const decrypted = crypto.privateDecrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        buffer
      );
      return decrypted.toString('base64');
    } catch (error) {
      console.error('Error decrypting key for user:', error);
      throw new Error('Failed to decrypt conversation key');
    }
  }

  // Encrypt message content
  encryptMessage(message, conversationKey) {
    try {
      const key = Buffer.from(conversationKey, 'base64');
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipher(this.algorithm, key, { iv });
      
      let encrypted = cipher.update(message, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      const tag = cipher.getAuthTag();
      
      return {
        encryptedContent: encrypted,
        iv: iv.toString('base64'),
        tag: tag.toString('base64')
      };
    } catch (error) {
      console.error('Error encrypting message:', error);
      throw new Error('Failed to encrypt message');
    }
  }

  // Decrypt message content
  decryptMessage(encryptedData, conversationKey) {
    try {
      const { encryptedContent, iv, tag } = encryptedData;
      const key = Buffer.from(conversationKey, 'base64');
      const ivBuffer = Buffer.from(iv, 'base64');
      const tagBuffer = Buffer.from(tag, 'base64');
      
      const decipher = crypto.createDecipher(this.algorithm, key, { iv: ivBuffer });
      decipher.setAuthTag(tagBuffer);
      
      let decrypted = decipher.update(encryptedContent, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Error decrypting message:', error);
      throw new Error('Failed to decrypt message');
    }
  }

  // Generate message hash for integrity verification
  generateMessageHash(message, timestamp, senderId) {
    const data = `${message}:${timestamp}:${senderId}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Verify message integrity
  verifyMessageHash(message, timestamp, senderId, hash) {
    const expectedHash = this.generateMessageHash(message, timestamp, senderId);
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  }

  // Generate secure random token for conversation IDs
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

module.exports = new EncryptionService();
