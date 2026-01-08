const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  files: [{
    type: String,
    trim: true
  }],
  description: {
    type: String,
    default: ''
  },
  // Cached failure summary from AI
  failureSummary: {
    summary: String,
    executionId: String,
    failureCount: Number,
    generatedAt: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
jobSchema.index({ owner: 1, name: 1 }, { unique: true });
jobSchema.index({ files: 1 });

module.exports = mongoose.model('Job', jobSchema);
