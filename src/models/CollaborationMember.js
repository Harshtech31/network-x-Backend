module.exports = (sequelize, DataTypes) => {
  const CollaborationMember = sequelize.define('CollaborationMember', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    role: {
      type: DataTypes.ENUM('organizer', 'participant', 'mentor'),
      defaultValue: 'participant'
    },
    joinDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('active', 'pending', 'completed', 'left'),
      defaultValue: 'pending'
    },
    skills: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    availability: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    contribution: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 5
      }
    },
    feedback: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    collaborationId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'collaborations',
        key: 'id'
      }
    }
  }, {
    tableName: 'collaboration_members',
    indexes: [
      {
        unique: true,
        fields: ['userId', 'collaborationId']
      },
      {
        fields: ['role']
      },
      {
        fields: ['status']
      }
    ]
  });

  return CollaborationMember;
};
