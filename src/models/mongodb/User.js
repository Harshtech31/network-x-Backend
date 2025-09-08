const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
  },
  bio: {
    type: String,
    maxlength: 500,
    default: ''
  },
  profileImage: {
    type: String,
    default: null
  },
  department: {
    type: String,
    maxlength: 100,
    default: ''
  },
  year: {
    type: Number,
    min: 1,
    max: 6,
    default: null
  },
  gpa: {
    type: Number,
    min: 0.0,
    max: 4.0,
    default: null
  },
  skills: [{
    type: String,
    trim: true
  }],
  interests: [{
    type: String,
    trim: true
  }],
  availability: {
    type: String,
    enum: ['available', 'busy', 'offline'],
    default: 'available'
  },
  rating: {
    type: Number,
    min: 0.0,
    max: 5.0,
    default: 0.0
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  passwordSalt: String,
  scryptSalt: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  emailVerificationToken: String,
  isEmailVerified: { type: Boolean, default: false },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  lastLogin: Date,
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  refreshToken: {
    type: String,
    default: null
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  verificationToken: {
    type: String,
    default: null
  },
  phoneNumber: {
    type: String,
    default: null
  },
  location: {
    type: String,
    default: null
  },
  socialLinks: {
    linkedin: { type: String, default: null },
    github: { type: String, default: null },
    twitter: { type: String, default: null },
    portfolio: { type: String, default: null }
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.refreshToken;
      delete ret.resetPasswordToken;
      delete ret.resetPasswordExpires;
      delete ret.verificationToken;
      return ret;
    }
  }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ department: 1 });
userSchema.index({ year: 1 });
userSchema.index({ availability: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ firstName: 'text', lastName: 'text', username: 'text', bio: 'text' });

// Enhanced password hashing with salting and multi-hashing
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    // Generate unique salt for this user
    const uniqueSalt = crypto.randomBytes(32).toString('hex');
    
    // First hash with bcrypt (industry standard)
    const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const bcryptHash = await bcrypt.hash(this.password, bcryptRounds);
    
    // Second hash with PBKDF2 using unique salt
    const pbkdf2Hash = crypto.pbkdf2Sync(bcryptHash, uniqueSalt, 100000, 64, 'sha512').toString('hex');
    
    // Third hash with scrypt for additional security
    const scryptSalt = crypto.randomBytes(16);
    const scryptHash = crypto.scryptSync(pbkdf2Hash, scryptSalt, 64).toString('hex');
    
    // Store the final hash and salts
    this.password = scryptHash;
    this.passwordSalt = uniqueSalt;
    this.scryptSalt = scryptSalt.toString('hex');
    
    next();
  } catch (error) {
    next(error);
  }
});

// Enhanced password comparison method
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    // Recreate the same hashing process
    const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const bcryptHash = await bcrypt.hash(candidatePassword, bcryptRounds);
    
    // Apply PBKDF2 with stored salt
    const pbkdf2Hash = crypto.pbkdf2Sync(bcryptHash, this.passwordSalt, 100000, 64, 'sha512').toString('hex');
    
    // Apply scrypt with stored salt
    const scryptSalt = Buffer.from(this.scryptSalt, 'hex');
    const scryptHash = crypto.scryptSync(pbkdf2Hash, scryptSalt, 64).toString('hex');
    
    // Compare with stored hash
    return crypto.timingSafeEqual(Buffer.from(this.password, 'hex'), Buffer.from(scryptHash, 'hex'));
  } catch (error) {
    return false;
  }
};

// Get full name
userSchema.methods.getFullName = function() {
  return `${this.firstName} ${this.lastName}`;
};

// Update rating
userSchema.methods.updateRating = function(newRating) {
  const totalScore = this.rating * this.totalRatings + newRating;
  this.totalRatings += 1;
  this.rating = totalScore / this.totalRatings;
  return this.save();
};

// Update last seen
userSchema.methods.updateLastSeen = function() {
  this.lastSeen = new Date();
  return this.save();
};

module.exports = mongoose.model('User', userSchema);
