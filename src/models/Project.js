module.exports = (sequelize, DataTypes) => {
  const Project = sequelize.define('Project', {
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
    category: {
      type: DataTypes.ENUM('web_development', 'mobile_app', 'data_science', 'ai_ml', 'blockchain', 'iot', 'research', 'business', 'design'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('planning', 'in_progress', 'completed', 'on_hold', 'cancelled'),
      defaultValue: 'planning'
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
      defaultValue: 'medium'
    },
    startDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    endDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    estimatedDuration: {
      type: DataTypes.STRING,
      allowNull: true
    },
    requiredSkills: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    technologies: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    maxMembers: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 50
      }
    },
    currentMembers: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    budget: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    repositoryUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    demoUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    projectImage: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    requiresApproval: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    progress: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100
      }
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
    tableName: 'projects',
    indexes: [
      {
        fields: ['creatorId']
      },
      {
        fields: ['category']
      },
      {
        fields: ['status']
      },
      {
        fields: ['priority']
      },
      {
        fields: ['isPublic']
      }
    ]
  });

  return Project;
};
