const express = require('express');
const TestResult = require('../models/TestResult');
const Job = require('../models/Job');
const auth = require('../middleware/auth');

const router = express.Router();

// Get results for a specific execution
router.get('/execution/:executionId', auth, async (req, res) => {
  try {
    const results = await TestResult.find({
      owner: req.user._id,
      executionId: req.params.executionId
    })
      .populate('job', 'name')
      .sort({ fileName: 1, title: 1 });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get results for a job
router.get('/job/:jobId', auth, async (req, res) => {
  try {
    const { limit = 100, offset = 0, state, executionId } = req.query;

    const query = {
      job: req.params.jobId,
      owner: req.user._id
    };

    if (state) query.state = state;
    if (executionId) query.executionId = executionId;

    const results = await TestResult.find(query)
      .sort({ timestamp: -1, fileName: 1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit));

    const total = await TestResult.countDocuments(query);

    res.json({ results, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest results for a job
router.get('/job/:jobId/latest', auth, async (req, res) => {
  try {
    // Find the latest execution
    const latestResult = await TestResult.findOne({
      job: req.params.jobId,
      owner: req.user._id
    }).sort({ timestamp: -1 });

    if (!latestResult) {
      return res.json({ results: [], executionId: null });
    }

    const results = await TestResult.find({
      job: req.params.jobId,
      executionId: latestResult.executionId
    }).sort({ fileName: 1, title: 1 });

    res.json({
      results,
      executionId: latestResult.executionId,
      timestamp: latestResult.timestamp
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get history for a job with date filtering
router.get('/job/:jobId/history', auth, async (req, res) => {
  try {
    const { startDate, endDate, limit = 100 } = req.query;

    const query = {
      job: req.params.jobId,
      owner: req.user._id
    };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const results = await TestResult.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get failed results for a job (latest execution)
router.get('/job/:jobId/failures', auth, async (req, res) => {
  try {
    // Find the latest execution
    const latestResult = await TestResult.findOne({
      job: req.params.jobId,
      owner: req.user._id
    }).sort({ timestamp: -1 });

    if (!latestResult) {
      return res.json({ results: [] });
    }

    const results = await TestResult.find({
      job: req.params.jobId,
      executionId: latestResult.executionId,
      state: 'failed'
    }).sort({ fileName: 1, title: 1 });

    res.json({
      results,
      executionId: latestResult.executionId,
      timestamp: latestResult.timestamp
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get history for a specific file
router.get('/file/:fileName', auth, async (req, res) => {
  try {
    const { limit = 50, startDate, endDate } = req.query;

    const query = {
      owner: req.user._id,
      fileName: decodeURIComponent(req.params.fileName)
    };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const results = await TestResult.find(query)
      .populate('job', 'name')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get result history with date filtering
router.get('/history', auth, async (req, res) => {
  try {
    const { from, to, jobId, fileName, state, limit = 100 } = req.query;

    const query = { owner: req.user._id };

    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(from);
      if (to) query.timestamp.$lte = new Date(to);
    }

    if (jobId) query.job = jobId;
    if (fileName) query.fileName = fileName;
    if (state) query.state = state;

    const results = await TestResult.find(query)
      .populate('job', 'name')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single result details
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await TestResult.findOne({
      _id: req.params.id,
      owner: req.user._id
    }).populate('job', 'name');

    if (!result) {
      return res.status(404).json({ error: 'Result not found' });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
