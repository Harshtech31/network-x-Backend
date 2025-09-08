module.exports = (sequelize, DataTypes) => {
  const Collaboration = sequelize.define('Collaboration', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [3, 200]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 2000]
      }
    },
    type: {
      type: DataTypes.ENUM('study_group', 'research', 'project_help', 'skill_exchange', 'mentorship', 'competition_team'),
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        len: [0, 100]
      }
    },
    duration: {
      type: DataTypes.ENUM('short_term', 'medium_term', 'long_term', 'ongoing'),
      defaultValue: 'medium_term'
    },
    meetingType: {
      type: DataTypes.ENUM('online', 'offline', 'hybrid'),
      defaultValue: 'hybrid'
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true
    },
    schedule: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    maxParticipants: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 2,
        max: 20
      }
    },
    currentParticipants: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    requiredSkills: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    status: {
      type: DataTypes.ENUM('open', 'in_progress', 'completed', 'cancelled'),
      defaultValue: 'open'
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    requiresApproval: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    creatorId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    }
  }, {
    tableName: 'collaborations',
    indexes: [
      {
        fields: ['creatorId']
      },
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['isPublic']
      }
    ]
  });

  return Collaboration;
};
