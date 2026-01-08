const express = require('express');
const axios = require('axios');
const TestResult = require('../models/TestResult');
const auth = require('../middleware/auth');

const router = express.Router();

const AI_API_URL = process.env.AI_API_URL || 'http://localhost:8000';

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

// Analyze failures for a specific execution
router.post('/execution/:executionId', auth, async (req, res) => {
  try {
    // Get all failed results for this execution
    const failedResults = await TestResult.find({
      owner: req.user._id,
      executionId: req.params.executionId,
      state: 'failed'
    });

    if (failedResults.length === 0) {
      return res.json({ message: 'No failed tests to analyze', analyzed: 0 });
    }

    // Prepare errors for AI analysis
    const errors = failedResults.map(result => ({
      title: result.title,
      state: result.state,
      error: result.error,
      fullError: result.fullError || result.stackError || result.completeError
    }));

    // Call AI API
    const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
      errors
    });

    const analysisResults = aiResponse.data.results || [];

    // Update test results with analysis
    for (let i = 0; i < failedResults.length && i < analysisResults.length; i++) {
      const analysis = analysisResults[i];
      await TestResult.findByIdAndUpdate(failedResults[i]._id, {
        'analysis.status': 'completed',
        'analysis.rootCause': analysis.rootCause,
        'analysis.suggestedFix': analysis.suggestedFix,
        'analysis.possibleCodeFix': analysis.possibleCodeFix,
        'analysis.locations': analysis.locations,
        'analysis.analyzedAt': new Date()
      });
    }

    res.json({
      message: 'Analysis completed',
      analyzed: analysisResults.length,
      total: failedResults.length
    });
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// Helper function to generate job summary after all failures are analyzed
async function generateJobSummary(jobId, executionId) {
  const Job = require('../models/Job');

  try {
    const job = await Job.findById(jobId);
    if (!job) return;

    // Get all failed results for this execution
    const failedResults = await TestResult.find({
      job: jobId,
      executionId: executionId,
      state: 'failed'
    });

    if (failedResults.length === 0) {
      job.failureSummary = null;
      await job.save();
      return;
    }

    // Categorize failures
    const scriptIssues = failedResults.filter(r => r.actionTaken?.type === 'script_issue');
    const randomFailures = failedResults.filter(r => r.actionTaken?.type === 'random_failure');
    const otherFailures = failedResults.filter(r => !r.actionTaken?.type);

    // Generate summary with AI
    const prompt = `Analyze these ${failedResults.length} test failures and provide a summary focusing on CRITICAL issues that need immediate attention.

Critical Failures (Script/Application Issues - ${scriptIssues.length}):
${scriptIssues.map((f, i) => `${i + 1}. ${f.title} (${f.fileName})
   Error: ${f.error || f.fullError || 'Unknown'}
   ${f.analysis?.rootCause ? `Root Cause: ${f.analysis.rootCause}` : ''}`).join('\n') || 'None'}

Random/Flaky Failures (${randomFailures.length}):
${randomFailures.map((f, i) => `${i + 1}. ${f.title}`).join('\n') || 'None'}

Other Failures (${otherFailures.length}):
${otherFailures.map((f, i) => `${i + 1}. ${f.title}`).join('\n') || 'None'}

Provide a summary with bullet points:
- Start with the most critical failures that block functionality
- Group similar issues together
- Mention flaky tests separately if any
- Give actionable recommendations`;

    let summary;
    try {
      const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
        errors: [{
          title: 'Job Failure Summary',
          state: 'failed',
          error: prompt,
          fullError: ''
        }]
      }, { timeout: 30000 });

      summary = aiResponse.data?.results?.[0]?.rootCause ||
        `${failedResults.length} test failures detected. Review individual errors for details.`;
    } catch (aiError) {
      summary = `- ${failedResults.length} total failures detected\n- ${scriptIssues.length} CRITICAL script/application issues requiring immediate attention\n- ${randomFailures.length} random/flaky failures (lower priority)\n- ${otherFailures.length} failures pending analysis\n- Review individual test results for detailed information`;
    }

    // Save summary to database
    job.failureSummary = {
      summary,
      executionId: executionId,
      failureCount: failedResults.length,
      generatedAt: new Date()
    };
    await job.save();

    console.log(`Generated summary for job ${jobId}: ${failedResults.length} failures`);
  } catch (error) {
    console.error('Failed to generate job summary:', error.message);
  }
}

// Analyze failures for a job (latest execution)
router.post('/job/:jobId', auth, async (req, res) => {
  try {
    // Find the latest execution
    const latestResult = await TestResult.findOne({
      job: req.params.jobId,
      owner: req.user._id
    }).sort({ timestamp: -1 });

    if (!latestResult) {
      return res.status(404).json({ error: 'No results found for this job' });
    }

    // Get all failed results for this execution
    const failedResults = await TestResult.find({
      job: req.params.jobId,
      executionId: latestResult.executionId,
      state: 'failed'
    });

    if (failedResults.length === 0) {
      return res.json({ message: 'No failed tests to analyze', analyzed: 0 });
    }

    // Mark as analyzing
    await TestResult.updateMany(
      { _id: { $in: failedResults.map(r => r._id) } },
      { 'analysis.status': 'analyzing' }
    );

    // Prepare errors for AI analysis
    const errors = failedResults.map(result => ({
      title: result.title,
      state: result.state,
      error: result.error,
      fullError: result.fullError || result.stackError || result.completeError
    }));

    // Call AI API
    const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
      errors
    });

    const analysisResults = aiResponse.data.results || [];

    // Update test results with analysis and determine action
    for (let i = 0; i < failedResults.length && i < analysisResults.length; i++) {
      const analysis = analysisResults[i];
      const result = await TestResult.findByIdAndUpdate(failedResults[i]._id, {
        'analysis.status': 'completed',
        'analysis.rootCause': analysis.rootCause,
        'analysis.suggestedFix': analysis.suggestedFix,
        'analysis.possibleCodeFix': analysis.possibleCodeFix,
        'analysis.locations': analysis.locations,
        'analysis.analyzedAt': new Date()
      }, { new: true });

      // Determine action based on history
      const actionTaken = await determineActionForResult(result);
      await TestResult.findByIdAndUpdate(result._id, { actionTaken });
    }

    // Generate job summary after all failures are analyzed
    await generateJobSummary(req.params.jobId, latestResult.executionId);

    res.json({
      message: 'Analysis completed',
      executionId: latestResult.executionId,
      analyzed: analysisResults.length,
      total: failedResults.length
    });
  } catch (error) {
    console.error('Analysis error:', error.message);

    // Mark as failed
    await TestResult.updateMany(
      { job: req.params.jobId, state: 'failed', 'analysis.status': 'analyzing' },
      { 'analysis.status': 'failed' }
    );

    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// Analyze a single test result
router.post('/result/:id', auth, async (req, res) => {
  try {
    const result = await TestResult.findOne({
      _id: req.params.id,
      owner: req.user._id,
      state: 'failed'
    });

    if (!result) {
      return res.status(404).json({ error: 'Failed result not found' });
    }

    // Mark as analyzing
    result.analysis.status = 'analyzing';
    await result.save();

    // Prepare error for AI analysis
    const errors = [{
      title: result.title,
      state: result.state,
      error: result.error,
      fullError: result.fullError || result.stackError || result.completeError
    }];

    // Call AI API for root cause analysis
    const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
      errors
    });

    const analysis = aiResponse.data.results?.[0];

    if (analysis) {
      result.analysis = {
        status: 'completed',
        rootCause: analysis.rootCause,
        suggestedFix: analysis.suggestedFix,
        possibleCodeFix: analysis.possibleCodeFix,
        locations: analysis.locations,
        analyzedAt: new Date()
      };
      await result.save();

      // Now determine action based on history
      const actionTaken = await determineActionForResult(result);
      result.actionTaken = actionTaken;
      await result.save();
    }

    res.json({
      message: 'Analysis completed',
      result
    });
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// Analyze with raw text
router.post('/raw', auth, async (req, res) => {
  try {
    const { rawText } = req.body;

    if (!rawText) {
      return res.status(400).json({ error: 'rawText is required' });
    }

    // Call AI API with raw text
    const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
      raw_text: rawText
    });

    res.json(aiResponse.data);
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// Check AI service health
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${AI_API_URL}/health`);
    res.json({ ai_service: 'connected', ...response.data });
  } catch (error) {
    res.json({ ai_service: 'disconnected', error: error.message });
  }
});

// Determine action based on test history
router.post('/determine-action/:id', auth, async (req, res) => {
  try {
    const result = await TestResult.findOne({
      _id: req.params.id,
      owner: req.user._id
    });

    if (!result) {
      return res.status(404).json({ error: 'Result not found' });
    }

    // Get historical results for the same test (by title and fileName)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const historicalResults = await TestResult.find({
      job: result.job,
      title: result.title,
      fileName: result.fileName,
      timestamp: { $gte: threeDaysAgo }
    }).sort({ timestamp: -1 });

    const totalRuns = historicalResults.length;
    const failedRuns = historicalResults.filter(r => r.state === 'failed').length;
    const passedRuns = historicalResults.filter(r => r.state === 'passed').length;

    // Check for consecutive failures by day
    const failuresByDay = {};
    historicalResults.forEach(r => {
      const day = r.timestamp.toISOString().split('T')[0];
      if (!failuresByDay[day]) {
        failuresByDay[day] = { failed: 0, passed: 0 };
      }
      if (r.state === 'failed') {
        failuresByDay[day].failed++;
      } else if (r.state === 'passed') {
        failuresByDay[day].passed++;
      }
    });

    // Count consecutive fail days (days with only failures, no passes)
    const sortedDays = Object.keys(failuresByDay).sort().reverse();
    let consecutiveFailDays = 0;
    for (const day of sortedDays) {
      if (failuresByDay[day].failed > 0 && failuresByDay[day].passed === 0) {
        consecutiveFailDays++;
      } else {
        break;
      }
    }

    // Determine if it's a consistent failure (failing for 3+ days) or random
    const isConsistentFailure = consecutiveFailDays >= 3 || (totalRuns > 0 && failedRuns === totalRuns);

    // Calculate failure rate
    const failureRate = totalRuns > 0 ? (failedRuns / totalRuns) * 100 : 0;

    // Determine action type
    let actionType;
    let explanation;

    if (isConsistentFailure) {
      actionType = 'script_issue';

      // Call AI to generate explanation for consistent failure
      try {
        const aiResponse = await axios.post(`${AI_API_URL}/analyze`, {
          raw_text: `This test has been failing consistently for ${consecutiveFailDays} days.
Test: ${result.title}
File: ${result.fileName}
Error: ${result.error || result.fullError || 'Unknown error'}
Root Cause: ${result.analysis?.rootCause || 'Not analyzed'}

History: ${failedRuns}/${totalRuns} runs failed in the last 3 days.

Based on this consistent failure pattern, provide a brief explanation of why this is likely a script or application issue that needs developer attention. Be concise (2-3 sentences).`
        }, { timeout: 30000 });

        explanation = aiResponse.data?.root_cause ||
          `This test has failed consistently for ${consecutiveFailDays} consecutive days (${failedRuns}/${totalRuns} runs). This indicates a persistent script or application issue that requires developer investigation.`;
      } catch (aiError) {
        explanation = `This test has failed consistently for ${consecutiveFailDays} consecutive days (${failedRuns}/${totalRuns} runs). This indicates a persistent script or application issue that requires developer investigation.`;
      }
    } else {
      actionType = 'random_failure';

      // Call AI to generate explanation for random failure
      try {
        const aiResponse = await axios.post(`${AI_API_URL}/analyze`, {
          raw_text: `This test shows intermittent failures.
Test: ${result.title}
File: ${result.fileName}
Error: ${result.error || result.fullError || 'Unknown error'}
Root Cause: ${result.analysis?.rootCause || 'Not analyzed'}

History: ${failedRuns}/${totalRuns} runs failed, ${passedRuns}/${totalRuns} passed in the last 3 days.
Failure rate: ${failureRate.toFixed(1)}%

Based on this intermittent failure pattern, provide a brief explanation of why this appears to be a flaky/random failure. Be concise (2-3 sentences).`
        }, { timeout: 30000 });

        explanation = aiResponse.data?.root_cause ||
          `This test shows intermittent behavior with ${failureRate.toFixed(1)}% failure rate (${failedRuns}/${totalRuns} runs). This suggests a flaky test possibly due to timing issues, external dependencies, or race conditions.`;
      } catch (aiError) {
        explanation = `This test shows intermittent behavior with ${failureRate.toFixed(1)}% failure rate (${failedRuns}/${totalRuns} runs). This suggests a flaky test possibly due to timing issues, external dependencies, or race conditions.`;
      }
    }

    // Update the result with action taken
    result.actionTaken = {
      status: 'completed',
      type: actionType,
      explanation,
      historyChecked: {
        totalRuns,
        failedRuns,
        passedRuns,
        consecutiveFailDays,
        isConsistentFailure
      },
      determinedAt: new Date()
    };

    await result.save();

    res.json({
      message: 'Action determined',
      actionTaken: result.actionTaken
    });
  } catch (error) {
    console.error('Determine action error:', error.message);
    res.status(500).json({ error: 'Failed to determine action: ' + error.message });
  }
});

// Get or generate AI summary for a job's failures (with caching)
router.get('/job-summary/:jobId', auth, async (req, res) => {
  try {
    const regenerate = req.query.regenerate === 'true';
    const Job = require('../models/Job');

    // Get job
    const job = await Job.findOne({ _id: req.params.jobId, owner: req.user._id });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get the latest execution for this job
    const latestResult = await TestResult.findOne({
      job: req.params.jobId,
      owner: req.user._id
    }).sort({ timestamp: -1 });

    if (!latestResult) {
      return res.status(404).json({ error: 'No results found for this job' });
    }

    // Check if we have a cached summary for this execution
    if (job.failureSummary?.executionId === latestResult.executionId && job.failureSummary?.summary) {
      // Return cached summary
      if (!regenerate) {
        return res.json({
          summary: job.failureSummary.summary,
          failureCount: job.failureSummary.failureCount,
          executionId: job.failureSummary.executionId,
          generatedAt: job.failureSummary.generatedAt,
          cached: true
        });
      }
    }

    // If not regenerating and no cache, just return null (don't auto-generate)
    if (!regenerate) {
      const failedCount = await TestResult.countDocuments({
        job: req.params.jobId,
        executionId: latestResult.executionId,
        state: 'failed'
      });
      return res.json({
        summary: null,
        failureCount: failedCount,
        executionId: latestResult.executionId,
        cached: false
      });
    }

    // Get all failed results for this execution (only when regenerating)
    const failedResults = await TestResult.find({
      job: req.params.jobId,
      executionId: latestResult.executionId,
      state: 'failed'
    });

    if (failedResults.length === 0) {
      // Clear any existing summary since there are no failures
      job.failureSummary = null;
      await job.save();
      return res.json({ summary: null, message: 'No failures to summarize' });
    }

    // Prepare failure info for AI - prioritize script issues as critical
    const scriptIssues = failedResults.filter(r => r.actionTaken?.type === 'script_issue');
    const randomFailures = failedResults.filter(r => r.actionTaken?.type === 'random_failure');
    const otherFailures = failedResults.filter(r => !r.actionTaken?.type);

    const failureInfo = [...scriptIssues, ...randomFailures, ...otherFailures].map(r => ({
      title: r.title,
      fileName: r.fileName,
      error: r.error || r.fullError || 'Unknown error',
      rootCause: r.analysis?.rootCause,
      actionType: r.actionTaken?.type,
      isCritical: r.actionTaken?.type === 'script_issue'
    }));

    // Generate summary with AI - focus on critical failures
    const prompt = `Analyze these ${failedResults.length} test failures and provide a summary focusing on CRITICAL issues that need immediate attention.

Critical Failures (Script/Application Issues - ${scriptIssues.length}):
${scriptIssues.map((f, i) => `${i + 1}. ${f.title} (${f.fileName})
   Error: ${f.error || f.fullError || 'Unknown'}
   ${f.analysis?.rootCause ? `Root Cause: ${f.analysis.rootCause}` : ''}`).join('\n') || 'None'}

Random/Flaky Failures (${randomFailures.length}):
${randomFailures.map((f, i) => `${i + 1}. ${f.title}`).join('\n') || 'None'}

Other Failures (${otherFailures.length}):
${otherFailures.map((f, i) => `${i + 1}. ${f.title}`).join('\n') || 'None'}

Provide a summary with bullet points:
- Start with the most critical failures that block functionality
- Group similar issues together
- Mention flaky tests separately if any
- Give actionable recommendations`;

    let summary;
    try {
      const aiResponse = await axios.post(`${AI_API_URL}/analyze-errors`, {
        errors: [{
          title: 'Job Failure Summary',
          state: 'failed',
          error: prompt,
          fullError: ''
        }]
      }, { timeout: 30000 });

      summary = aiResponse.data?.results?.[0]?.rootCause ||
        `${failedResults.length} test failures detected. Review individual errors for details.`;
    } catch (aiError) {
      // Fallback summary without AI
      summary = `- ${failedResults.length} total failures detected\n- ${scriptIssues.length} CRITICAL script/application issues requiring immediate attention\n- ${randomFailures.length} random/flaky failures (lower priority)\n- ${otherFailures.length} failures pending analysis\n- Review individual test results for detailed information`;
    }

    // Save summary to database
    job.failureSummary = {
      summary,
      executionId: latestResult.executionId,
      failureCount: failedResults.length,
      generatedAt: new Date()
    };
    await job.save();

    res.json({
      summary,
      failureCount: failedResults.length,
      executionId: latestResult.executionId,
      generatedAt: job.failureSummary.generatedAt,
      cached: false
    });
  } catch (error) {
    console.error('Job summary error:', error.message);
    res.status(500).json({ error: 'Failed to generate summary: ' + error.message });
  }
});

module.exports = router;
