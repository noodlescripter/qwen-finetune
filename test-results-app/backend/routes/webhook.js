const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const Job = require('../models/Job');
const TestResult = require('../models/TestResult');

const router = express.Router();

const AI_API_URL = process.env.AI_API_URL || 'http://localhost:8000';

// Generate unique execution ID
const generateExecutionId = () => {
  return `exec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
};

// Helper function to determine action based on test history (last 3 results)
async function determineActionForResult(result) {
  // Get the last 3 results for the same test (by title and fileName)
  const historicalResults = await TestResult.find({
    job: result.job,
    title: result.title,
    fileName: result.fileName
  }).sort({ timestamp: -1 }).limit(3);

  const totalRuns = historicalResults.length;
  const failedRuns = historicalResults.filter(r => r.state === 'failed').length;
  const passedRuns = historicalResults.filter(r => r.state === 'passed').length;

  // Check if all last 3 results are failures (consistent failure)
  const isConsistentFailure = totalRuns >= 3 && failedRuns === totalRuns;
  const failureRate = totalRuns > 0 ? (failedRuns / totalRuns) * 100 : 0;

  let actionType;
  let explanation;

  if (isConsistentFailure) {
    actionType = 'script_issue';
    try {
      const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
        errors: [{
          title: 'Action Determination',
          state: 'failed',
          error: `This test has failed consistently in the last ${totalRuns} runs. Test: ${result.title}, File: ${result.fileName}, Root Cause: ${result.analysis?.rootCause || 'Not analyzed'}. History: ${failedRuns}/${totalRuns} of the last runs failed. Based on this consistent failure pattern, provide a brief explanation of why this is likely a script or application issue that needs developer attention.`,
          fullError: result.error || result.fullError || 'Unknown error'
        }]
      }, { timeout: 30000 });
      explanation = aiResponse.data?.results?.[0]?.rootCause ||
        `This test has failed consistently in the last ${totalRuns} runs (${failedRuns}/${totalRuns} failed). This indicates a persistent script or application issue that requires developer investigation.`;
    } catch (aiError) {
      explanation = `This test has failed consistently in the last ${totalRuns} runs (${failedRuns}/${totalRuns} failed). This indicates a persistent script or application issue that requires developer investigation.`;
    }
  } else {
    actionType = 'random_failure';
    try {
      const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
        errors: [{
          title: 'Action Determination',
          state: 'failed',
          error: `This test shows intermittent failures. Test: ${result.title}, File: ${result.fileName}, Root Cause: ${result.analysis?.rootCause || 'Not analyzed'}. History: ${failedRuns}/${totalRuns} of the last runs failed, ${passedRuns}/${totalRuns} passed. Failure rate: ${failureRate.toFixed(1)}%. Based on this intermittent failure pattern, provide a brief explanation of why this appears to be a flaky/random failure.`,
          fullError: result.error || result.fullError || 'Unknown error'
        }]
      }, { timeout: 30000 });
      explanation = aiResponse.data?.results?.[0]?.rootCause ||
        `This test shows intermittent behavior with ${failureRate.toFixed(1)}% failure rate (${failedRuns}/${totalRuns} of last runs). This suggests a flaky test possibly due to timing issues, external dependencies, or race conditions.`;
    } catch (aiError) {
      explanation = `This test shows intermittent behavior with ${failureRate.toFixed(1)}% failure rate (${failedRuns}/${totalRuns} of last runs). This suggests a flaky test possibly due to timing issues, external dependencies, or race conditions.`;
    }
  }

  return {
    status: 'completed',
    type: actionType,
    explanation,
    historyChecked: {
      totalRuns,
      failedRuns,
      passedRuns,
      isConsistentFailure
    },
    determinedAt: new Date()
  };
}

// Async function to analyze failures in background
async function analyzeFailuresInBackground(failedResults) {
  console.log(`[Webhook] Starting background analysis for ${failedResults.length} failures...`);

  for (const result of failedResults) {
    try {
      // Mark as analyzing
      result.analysis.status = 'analyzing';
      await result.save();

      // Prepare error for AI analysis (same format as analysis.js)
      const errors = [{
        title: result.title,
        state: result.state,
        error: result.error,
        fullError: result.fullError || result.stackError || result.completeError
      }];

      // Call AI for root cause analysis using /analyze-errors endpoint
      const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
        errors
      }, { timeout: 30000 });

      const analysis = aiResponse.data?.results?.[0];

      // Update with analysis results
      result.analysis = {
        status: 'completed',
        rootCause: analysis?.rootCause || 'Unable to determine root cause',
        suggestedFix: analysis?.suggestedFix || 'Review the error and test code',
        possibleCodeFix: analysis?.possibleCodeFix || null,
        locations: analysis?.locations || [],
        analyzedAt: new Date()
      };
      await result.save();

      // Determine action based on history
      const actionTaken = await determineActionForResult(result);
      result.actionTaken = actionTaken;
      await result.save();

      console.log(`[Webhook] Analyzed: ${result.title} - ${actionTaken.type}`);
    } catch (error) {
      console.error(`[Webhook] Analysis failed for ${result.title}:`, error.message);
      result.analysis = {
        status: 'failed',
        rootCause: 'AI analysis unavailable',
        suggestedFix: 'Please try again later or check AI service',
        analyzedAt: new Date()
      };
      await result.save();
    }
  }

  console.log(`[Webhook] Background analysis completed for ${failedResults.length} failures`);
}

// Webhook endpoint - receives test results
router.post('/', async (req, res) => {
  try {
    const { results } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Invalid results format. Expected array.' });
    }

    const executionId = generateExecutionId();
    const timestamp = new Date();
    const savedResults = [];
    const unmatchedFiles = [];
    const prerequisiteFiles = []; // Files that matched multiple jobs

    // Group results by fileName
    const resultsByFile = {};
    for (const result of results) {
      const fileName = result.fileName;
      if (!resultsByFile[fileName]) {
        resultsByFile[fileName] = [];
      }
      resultsByFile[fileName].push(result);
    }

    // Find jobs that own these files
    for (const [fileName, fileResults] of Object.entries(resultsByFile)) {
      // Find ALL jobs that have this file (handles prerequisite files)
      const jobs = await Job.find({ files: fileName }).populate('owner');

      if (jobs.length === 0) {
        unmatchedFiles.push(fileName);
        continue;
      }

      // Track if this is a prerequisite file (matches multiple jobs)
      if (jobs.length > 1) {
        prerequisiteFiles.push({ fileName, jobCount: jobs.length });
      }

      // Save results to ALL matching jobs
      for (const job of jobs) {
        for (const result of fileResults) {
          const testResult = new TestResult({
            job: job._id,
            owner: job.owner._id,
            fileName: result.fileName,
            title: result.title,
            state: result.state || 'pending',
            duration: result.duration || 0,
            error: result.error || null,
            fullError: result.fullError || null,
            stackError: result.stackError || null,
            completeError: result.completeError || null,
            executionId,
            timestamp,
            analysis: {
              status: result.state === 'failed' ? 'pending' : 'completed'
            }
          });

          await testResult.save();
          savedResults.push(testResult);
        }
      }
    }

    // Get failed results for background analysis
    const failedResults = savedResults.filter(r => r.state === 'failed');

    // Start background analysis (don't await - runs async)
    if (failedResults.length > 0) {
      analyzeFailuresInBackground(failedResults).catch(err => {
        console.error('[Webhook] Background analysis error:', err.message);
      });
    }

    res.status(201).json({
      message: 'Results received',
      executionId,
      saved: savedResults.length,
      failed: failedResults.length,
      analyzing: failedResults.length > 0,
      prerequisiteFiles, // Files that matched multiple jobs
      unmatched: unmatchedFiles,
      timestamp
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook with API key (for external systems)
// API key can be used to restrict which owner's jobs are matched
router.post('/external/:apiKey', async (req, res) => {
  try {
    const { apiKey } = req.params;
    const { results } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Invalid results format' });
    }

    // Find owner by API key (stored in job description for simplicity)
    const jobWithKey = await Job.findOne({ description: apiKey }).populate('owner');
    const ownerId = jobWithKey?.owner?._id;

    if (!ownerId) {
      return res.status(404).json({ error: 'Invalid API key - no jobs found' });
    }

    const executionId = generateExecutionId();
    const timestamp = new Date();
    const savedResults = [];
    const unmatchedFiles = [];
    const prerequisiteFiles = [];

    // Group results by fileName
    const resultsByFile = {};
    for (const result of results) {
      const fileName = result.fileName;
      if (!resultsByFile[fileName]) {
        resultsByFile[fileName] = [];
      }
      resultsByFile[fileName].push(result);
    }

    // Find jobs that own these files (restricted to the API key owner)
    for (const [fileName, fileResults] of Object.entries(resultsByFile)) {
      // Find ALL jobs for this owner that have this file
      const jobs = await Job.find({
        files: fileName,
        owner: ownerId
      }).populate('owner');

      if (jobs.length === 0) {
        unmatchedFiles.push(fileName);
        continue;
      }

      // Track if this is a prerequisite file
      if (jobs.length > 1) {
        prerequisiteFiles.push({ fileName, jobCount: jobs.length });
      }

      // Save results to ALL matching jobs
      for (const job of jobs) {
        for (const result of fileResults) {
          const testResult = new TestResult({
            job: job._id,
            owner: job.owner._id,
            fileName: result.fileName,
            title: result.title,
            state: result.state || 'pending',
            duration: result.duration || 0,
            error: result.error || null,
            fullError: result.fullError || null,
            stackError: result.stackError || null,
            completeError: result.completeError || null,
            executionId,
            timestamp,
            analysis: {
              status: result.state === 'failed' ? 'pending' : 'completed'
            }
          });

          await testResult.save();
          savedResults.push(testResult);
        }
      }
    }

    // Get failed results for background analysis
    const failedResults = savedResults.filter(r => r.state === 'failed');

    // Start background analysis (don't await - runs async)
    if (failedResults.length > 0) {
      analyzeFailuresInBackground(failedResults).catch(err => {
        console.error('[Webhook] Background analysis error:', err.message);
      });
    }

    res.status(201).json({
      message: 'Results received',
      executionId,
      saved: savedResults.length,
      failed: failedResults.length,
      analyzing: failedResults.length > 0,
      prerequisiteFiles,
      unmatched: unmatchedFiles,
      timestamp
    });
  } catch (error) {
    console.error('External webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
