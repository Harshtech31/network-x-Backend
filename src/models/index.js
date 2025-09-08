const { sequelize, Sequelize } = require('../config/database');

// Import all models
const User = require('./User');
const Event = require('./Event');
const Post = require('./Post');
const Club = require('./Club');
const Project = require('./Project');
const Collaboration = require('./Collaboration');
const Message = require('./Message');
const Notification = require('./Notification');
const Connection = require('./Connection');
const EventRegistration = require('./EventRegistration');
const ClubMember = require('./ClubMember');
const ProjectMember = require('./ProjectMember');
const CollaborationMember = require('./CollaborationMember');

// Initialize models
const models = {
  User: User(sequelize, Sequelize.DataTypes),
  Event: Event(sequelize, Sequelize.DataTypes),
  Post: Post(sequelize, Sequelize.DataTypes),
  Club: Club(sequelize, Sequelize.DataTypes),
  Project: Project(sequelize, Sequelize.DataTypes),
  Collaboration: Collaboration(sequelize, Sequelize.DataTypes),
  Message: Message(sequelize, Sequelize.DataTypes),
  Notification: Notification(sequelize, Sequelize.DataTypes),
  Connection: Connection(sequelize, Sequelize.DataTypes),
  EventRegistration: EventRegistration(sequelize, Sequelize.DataTypes),
  ClubMember: ClubMember(sequelize, Sequelize.DataTypes),
  ProjectMember: ProjectMember(sequelize, Sequelize.DataTypes),
  CollaborationMember: CollaborationMember(sequelize, Sequelize.DataTypes)
};

// Define associations
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// User associations
models.User.hasMany(models.Event, { foreignKey: 'creator_id', as: 'createdEvents' });
models.User.hasMany(models.Post, { foreignKey: 'author_id', as: 'posts' });
models.User.hasMany(models.Club, { foreignKey: 'creator_id', as: 'createdClubs' });
models.User.hasMany(models.Project, { foreignKey: 'creator_id', as: 'createdProjects' });
models.User.hasMany(models.Collaboration, { foreignKey: 'creator_id', as: 'createdCollaborations' });
models.User.hasMany(models.Message, { foreignKey: 'sender_id', as: 'sentMessages' });
models.User.hasMany(models.Message, { foreignKey: 'receiver_id', as: 'receivedMessages' });
models.User.hasMany(models.Notification, { foreignKey: 'user_id', as: 'notifications' });

// Connection associations (self-referencing)
models.User.belongsToMany(models.User, {
  through: models.Connection,
  as: 'connections',
  foreignKey: 'user_id',
  otherKey: 'connected_user_id'
});

// Event associations
models.Event.belongsTo(models.User, { foreignKey: 'creator_id', as: 'creator' });
models.Event.belongsToMany(models.User, {
  through: models.EventRegistration,
  as: 'registeredUsers',
  foreignKey: 'event_id',
  otherKey: 'user_id'
});

// Post associations
models.Post.belongsTo(models.User, { foreignKey: 'author_id', as: 'author' });

// Club associations
models.Club.belongsTo(models.User, { foreignKey: 'creator_id', as: 'creator' });
models.Club.belongsToMany(models.User, {
  through: models.ClubMember,
  as: 'members',
  foreignKey: 'club_id',
  otherKey: 'user_id'
});

// Project associations
models.Project.belongsTo(models.User, { foreignKey: 'creator_id', as: 'creator' });
models.Project.belongsToMany(models.User, {
  through: models.ProjectMember,
  as: 'members',
  foreignKey: 'project_id',
  otherKey: 'user_id'
});

// Collaboration associations
models.Collaboration.belongsTo(models.User, { foreignKey: 'creator_id', as: 'creator' });
models.Collaboration.belongsToMany(models.User, {
  through: models.CollaborationMember,
  as: 'members',
  foreignKey: 'collaboration_id',
  otherKey: 'user_id'
});

// Message associations
models.Message.belongsTo(models.User, { foreignKey: 'sender_id', as: 'sender' });
models.Message.belongsTo(models.User, { foreignKey: 'receiver_id', as: 'receiver' });

// Notification associations
models.Notification.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });

models.sequelize = sequelize;
models.Sequelize = Sequelize;

module.exports = models;
