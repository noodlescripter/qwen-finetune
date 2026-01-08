const mongoose = require('mongoose');

const testResultSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  title: {
    type: String,
    required: true
  },
  state: {
    type: String,
    enum: ['passed', 'failed', 'skipped', 'pending'],
    required: true
  },
  duration: {
    type: Number,
    default: 0
  },
  error: {
    type: String,
    default: null
  },
  fullError: {
    type: String,
    default: null
  },
  stackError: {
    type: String,
    default: null
  },
  completeError: {
    type: String,
    default: null
  },
  // AI Analysis fields
  analysis: {
    status: {
      type: String,
      enum: ['pending', 'analyzing', 'completed', 'failed'],
      default: 'pending'
    },
    rootCause: String,
    suggestedFix: String,
    possibleCodeFix: String,
    locations: [{
      file: String,
      line: Number,
      column: Number,
      code: String
    }],
    analyzedAt: Date
  },
  // Action Taken fields (based on historical analysis)
  actionTaken: {
    status: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending'
    },
    type: {
      type: String,
      enum: ['script_issue', 'application_issue', 'random_failure', null],
      default: null
    },
    explanation: String,
    historyChecked: {
      totalRuns: Number,
      failedRuns: Number,
      passedRuns: Number,
      isConsistentFailure: Boolean
    },
    determinedAt: Date
  },
  // Execution tracking
  executionId: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Indexes for efficient queries
testResultSchema.index({ job: 1, timestamp: -1 });
testResultSchema.index({ owner: 1, timestamp: -1 });
testResultSchema.index({ fileName: 1, timestamp: -1 });
testResultSchema.index({ executionId: 1 });
testResultSchema.index({ state: 1 });

module.exports = mongoose.model('TestResult', testResultSchema);
