const express = require('express');
const Job = require('../models/Job');
const TestResult = require('../models/TestResult');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all jobs for current user
router.get('/', auth, async (req, res) => {
  try {
    const jobs = await Job.find({ owner: req.user._id })
      .sort({ updatedAt: -1 });

    // Get latest execution stats for each job
    const jobsWithStats = await Promise.all(
      jobs.map(async (job) => {
        const latestExecution = await TestResult.findOne({ job: job._id })
          .sort({ timestamp: -1 })
          .select('executionId timestamp');

        let stats = { passed: 0, failed: 0, total: 0 };
        if (latestExecution) {
          const results = await TestResult.find({
            job: job._id,
            executionId: latestExecution.executionId
          });
          stats.total = results.length;
          stats.passed = results.filter(r => r.state === 'passed').length;
          stats.failed = results.filter(r => r.state === 'failed').length;
          stats.lastRun = latestExecution.timestamp;
        }

        return {
          ...job.toObject(),
          stats
        };
      })
    );

    res.json({ jobs: jobsWithStats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single job with details
router.get('/:id', auth, async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.id,
      owner: req.user._id
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get execution history
    const executions = await TestResult.aggregate([
      { $match: { job: job._id } },
      { $group: {
        _id: '$executionId',
        timestamp: { $first: '$timestamp' },
        total: { $sum: 1 },
        passed: { $sum: { $cond: [{ $eq: ['$state', 'passed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$state', 'failed'] }, 1, 0] } }
      }},
      { $sort: { timestamp: -1 } },
      { $limit: 20 }
    ]);

    res.json({ job, executions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new job
router.post('/', auth, async (req, res) => {
  try {
    const { name, files, description } = req.body;

    if (!name || !files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'Name and files array required' });
    }

    const job = new Job({
      name,
      owner: req.user._id,
      files,
      description: description || ''
    });

    await job.save();
    res.status(201).json(job);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Job name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update job
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, files, description } = req.body;

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
      { name, files, description, updatedAt: Date.now() },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete job
router.delete('/:id', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndDelete({
      _id: req.params.id,
      owner: req.user._id
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Delete associated test results
    await TestResult.deleteMany({ job: job._id });

    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
