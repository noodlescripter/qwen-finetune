const express = require('express');
const User = require('../models/User');
const Job = require('../models/Job');
const TestResult = require('../models/TestResult');
const axios = require('axios');

const router = express.Router();

// Get overall results for all users (public endpoint)
router.get('/results', async (req, res) => {
  try {
    const { email, jobName, state } = req.query;

    // Build user filter
    const userFilter = {};
    if (email) {
      userFilter.email = { $regex: email, $options: 'i' };
    }

    // Get all users
    const users = await User.find(userFilter).select('email name');

    const results = [];

    for (const user of users) {
      // Get all jobs for this user
      let jobFilter = { owner: user._id };
      if (jobName) {
        jobFilter.name = { $regex: jobName, $options: 'i' };
      }

      const jobs = await Job.find(jobFilter);

      if (jobs.length === 0) continue;

      let totalPassed = 0;
      let totalFailed = 0;
      let totalTests = 0;
      const jobDetails = [];
      const allErrors = [];
      const allRootCauses = [];

      for (const job of jobs) {
        // Get latest execution for this job
        const latestResult = await TestResult.findOne({ job: job._id })
          .sort({ timestamp: -1 });

        if (!latestResult) continue;

        // Get all results from latest execution
        const execResults = await TestResult.find({
          job: job._id,
          executionId: latestResult.executionId
        });

        const passed = execResults.filter(r => r.state === 'passed').length;
        const failed = execResults.filter(r => r.state === 'failed').length;
        const total = execResults.length;

        totalPassed += passed;
        totalFailed += failed;
        totalTests += total;

        // Collect errors and root causes
        const failedResults = execResults.filter(r => r.state === 'failed');
        for (const fr of failedResults) {
          if (fr.error) allErrors.push(fr.error);
          if (fr.analysis?.rootCause) allRootCauses.push(fr.analysis.rootCause);
        }

        // Track analysis status
        const analyzedCount = failedResults.filter(fr => fr.analysis?.status === 'completed').length;
        const pendingCount = failedResults.length - analyzedCount;

        jobDetails.push({
          _id: job._id,
          name: job.name,
          description: job.description,
          files: job.files,
          passed,
          failed,
          total,
          passRate: total > 0 ? ((passed / total) * 100).toFixed(1) : 0,
          failRate: total > 0 ? ((failed / total) * 100).toFixed(1) : 0,
          lastRun: latestResult.timestamp,
          executionId: latestResult.executionId,
          analyzedCount,
          pendingCount,
          analysisComplete: pendingCount === 0 && failedResults.length > 0,
          failures: failedResults.map(fr => ({
            _id: fr._id,
            title: fr.title,
            fileName: fr.fileName,
            error: fr.error,
            fullError: fr.fullError,
            analysisStatus: fr.analysis?.status || 'pending',
            rootCause: fr.analysis?.rootCause,
            suggestedFix: fr.analysis?.suggestedFix,
            possibleCodeFix: fr.analysis?.possibleCodeFix,
            actionTaken: fr.actionTaken ? {
              status: fr.actionTaken.status,
              type: fr.actionTaken.type,
              explanation: fr.actionTaken.explanation,
              historyChecked: fr.actionTaken.historyChecked
            } : null
          }))
        });
      }

      // Skip if no test results based on state filter
      if (state === 'failed' && totalFailed === 0) continue;
      if (state === 'passed' && totalFailed > 0) continue;

      // Calculate overall analysis status
      const totalAnalyzed = jobDetails.reduce((a, j) => a + j.analyzedCount, 0);
      const totalPending = jobDetails.reduce((a, j) => a + j.pendingCount, 0);
      const analysisComplete = totalFailed === 0 || (totalPending === 0 && totalFailed > 0);

      results.push({
        email: user.email,
        name: user.name,
        totalPassed,
        totalFailed,
        totalTests,
        passRate: totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0,
        failRate: totalTests > 0 ? ((totalFailed / totalTests) * 100).toFixed(1) : 0,
        errors: allErrors.slice(0, 5),
        rootCauses: allRootCauses,
        combinedRootCause: null,
        totalAnalyzed,
        totalPending,
        analysisComplete,
        analysisStatus: analysisComplete ? 'completed' : (totalAnalyzed > 0 ? 'partial' : 'pending'),
        jobs: jobDetails
      });
    }

    // Sort: pending analysis first, then partial, then completed
    results.sort((a, b) => {
      const order = { pending: 0, partial: 1, completed: 2 };
      return order[a.analysisStatus] - order[b.analysisStatus];
    });

    res.json({ results });
  } catch (error) {
    console.error('Public results error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to determine action based on test history (last 3 results)
async function determineActionForResult(result, aiUrl) {
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
      const aiResponse = await axios.post(`${aiUrl}/analyze-errors`, {
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
      const aiResponse = await axios.post(`${aiUrl}/analyze-errors`, {
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

// Analyze all failures for a user with AI
router.post('/analyze-user/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all pending failed results for this user
    const pendingResults = await TestResult.find({
      owner: user._id,
      state: 'failed',
      'analysis.status': { $ne: 'completed' }
    });

    if (pendingResults.length === 0) {
      return res.json({ message: 'No pending failures to analyze', analyzed: 0 });
    }

    const aiUrl = process.env.AI_API_URL || 'http://localhost:8000';
    let analyzedCount = 0;

    for (const result of pendingResults) {
      result.analysis = result.analysis || {};
      result.analysis.status = 'analyzing';
      await result.save();

      try {
        // Prepare error for AI analysis (same format as analysis.js)
        const errors = [{
          title: result.title,
          state: result.state,
          error: result.error,
          fullError: result.fullError || result.stackError || result.completeError
        }];

        const aiResponse = await axios.post(`${aiUrl}/analyze-errors`, {
          errors
        }, { timeout: 30000 });

        const analysis = aiResponse.data?.results?.[0];

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
        const actionTaken = await determineActionForResult(result, aiUrl);
        result.actionTaken = actionTaken;
        await result.save();

        analyzedCount++;
      } catch (aiError) {
        result.analysis = {
          status: 'failed',
          rootCause: 'AI analysis unavailable',
          suggestedFix: 'Please try again later or check AI service',
          analyzedAt: new Date()
        };
        await result.save();
      }
    }

    res.json({
      success: true,
      analyzed: analyzedCount,
      total: pendingResults.length
    });
  } catch (error) {
    console.error('Analyze user failures error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate combined root cause using AI
router.post('/analyze-combined/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all failed results for this user
    const failedResults = await TestResult.find({
      owner: user._id,
      state: 'failed'
    }).sort({ timestamp: -1 }).limit(20);

    if (failedResults.length === 0) {
      return res.json({ combinedRootCause: 'No failures found' });
    }

    // Collect all errors for combined analysis
    const errorSummaries = failedResults.map(r => ({
      job: r.job,
      title: r.title,
      error: r.error || r.fullError,
      rootCause: r.analysis?.rootCause
    }));

    // Call AI API
    const aiUrl = process.env.AI_API_URL || 'http://localhost:8000';

    const combinedError = `Analyze these test failures and provide a combined summary of the root causes. Be concise but comprehensive.

Failures:
${errorSummaries.map((e, i) => `${i + 1}. ${e.title}: ${e.error || 'No error message'}`).join('\n')}

Individual Root Causes:
${errorSummaries.filter(e => e.rootCause).map((e, i) => `- ${e.rootCause}`).join('\n') || 'None analyzed yet'}

Provide a 2-3 sentence summary of the overall issues.`;

    try {
      const aiResponse = await axios.post(`${aiUrl}/analyze-errors`, {
        errors: [{
          title: 'Combined Analysis',
          state: 'failed',
          error: combinedError,
          fullError: ''
        }]
      }, { timeout: 30000 });

      const combinedRootCause = aiResponse.data?.results?.[0]?.rootCause ||
        'Multiple test failures detected. Run individual analysis for details.';

      res.json({ combinedRootCause });
    } catch (aiError) {
      // Fallback if AI is not available
      const fallback = errorSummaries.filter(e => e.rootCause).map(e => e.rootCause).join('; ') ||
        'Multiple failures detected. Please analyze individual tests.';
      res.json({ combinedRootCause: fallback });
    }
  } catch (error) {
    console.error('Combined analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate HTML report
router.get('/report', async (req, res) => {
  try {
    const { email } = req.query;

    let userFilter = {};
    if (email) {
      userFilter.email = email;
    }

    const users = await User.find(userFilter).select('email name');

    let reportData = [];

    for (const user of users) {
      const jobs = await Job.find({ owner: user._id });

      let userData = {
        email: user.email,
        name: user.name,
        jobs: []
      };

      for (const job of jobs) {
        const latestResult = await TestResult.findOne({ job: job._id })
          .sort({ timestamp: -1 });

        if (!latestResult) continue;

        const execResults = await TestResult.find({
          job: job._id,
          executionId: latestResult.executionId
        });

        const passed = execResults.filter(r => r.state === 'passed').length;
        const failed = execResults.filter(r => r.state === 'failed').length;

        userData.jobs.push({
          name: job.name,
          description: job.description,
          passed,
          failed,
          total: execResults.length,
          passRate: execResults.length > 0 ? ((passed / execResults.length) * 100).toFixed(1) : 0,
          lastRun: latestResult.timestamp,
          executionId: latestResult.executionId,
          failures: execResults.filter(r => r.state === 'failed').map(r => ({
            title: r.title,
            fileName: r.fileName,
            error: r.error,
            fullError: r.fullError,
            stackError: r.stackError,
            // Analysis
            analysisStatus: r.analysis?.status || 'pending',
            rootCause: r.analysis?.rootCause,
            suggestedFix: r.analysis?.suggestedFix,
            possibleCodeFix: r.analysis?.possibleCodeFix,
            // Action Taken
            actionTaken: r.actionTaken ? {
              type: r.actionTaken.type,
              explanation: r.actionTaken.explanation,
              historyChecked: r.actionTaken.historyChecked
            } : null
          }))
        });
      }

      if (userData.jobs.length > 0) {
        reportData.push(userData);
      }
    }

    // Generate HTML
    const html = generateHTMLReport(reportData);

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="test-report-${Date.now()}.html"`);
    res.send(html);
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

function generateHTMLReport(data) {
  const timestamp = new Date().toLocaleString();

  // Helper to escape HTML
  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Helper to format text with line breaks
  const formatText = (str) => {
    if (!str) return '';
    return escapeHtml(str).replace(/\n/g, '<br>');
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Results Report - ${timestamp}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #111827; color: #e5e7eb; padding: 2rem; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #22d3ee; margin-bottom: 0.5rem; }
    .timestamp { color: #9ca3af; margin-bottom: 2rem; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .summary-card { background: #1f2937; border-radius: 8px; padding: 1rem; text-align: center; }
    .summary-value { font-size: 2rem; font-weight: 700; }
    .summary-label { font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem; }
    .user-card { background: #1f2937; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #374151; }
    .user-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #374151; }
    .user-email { font-size: 1.25rem; font-weight: 600; color: #22d3ee; }
    .stats { display: flex; gap: 1rem; }
    .stat { padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.875rem; }
    .stat-pass { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
    .stat-fail { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
    .job { background: #111827; border-radius: 8px; padding: 1rem; margin-top: 1rem; }
    .job-name { font-weight: 600; color: #f3f4f6; margin-bottom: 0.25rem; }
    .job-desc { font-size: 0.75rem; color: #6b7280; margin-bottom: 0.5rem; }
    .job-stats { font-size: 0.875rem; color: #9ca3af; }
    .failures { margin-top: 1rem; }
    .failure { background: rgba(239, 68, 68, 0.05); border-left: 3px solid #ef4444; padding: 1rem; margin-top: 0.75rem; border-radius: 0 8px 8px 0; }
    .failure-header { display: flex; justify-content: space-between; align-items: start; }
    .failure-title { font-weight: 600; color: #fca5a5; font-size: 0.95rem; }
    .failure-file { font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem; }
    .failure-status { font-size: 0.7rem; padding: 0.25rem 0.5rem; border-radius: 4px; }
    .status-completed { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
    .status-pending { background: rgba(234, 179, 8, 0.2); color: #eab308; }
    .error-section { margin-top: 0.75rem; }
    .error-label { font-size: 0.7rem; color: #9ca3af; text-transform: uppercase; margin-bottom: 0.25rem; }
    .error-box { font-family: 'Monaco', 'Menlo', monospace; font-size: 0.75rem; color: #f87171; background: #1f2937; padding: 0.75rem; border-radius: 4px; white-space: pre-wrap; word-break: break-all; max-height: 150px; overflow-y: auto; }
    .analysis-section { margin-top: 0.75rem; padding: 0.75rem; background: rgba(168, 85, 247, 0.1); border-radius: 6px; border: 1px solid rgba(168, 85, 247, 0.2); }
    .analysis-title { font-size: 0.8rem; font-weight: 600; color: #a855f7; margin-bottom: 0.5rem; }
    .analysis-item { margin-top: 0.5rem; }
    .analysis-label { font-size: 0.7rem; color: #9ca3af; text-transform: uppercase; }
    .analysis-text { font-size: 0.85rem; color: #e9d5ff; margin-top: 0.25rem; line-height: 1.5; }
    .code-fix { font-family: 'Monaco', 'Menlo', monospace; font-size: 0.75rem; color: #4ade80; background: #0f172a; padding: 0.75rem; border-radius: 4px; white-space: pre-wrap; margin-top: 0.25rem; max-height: 200px; overflow-y: auto; }
    .action-section { margin-top: 0.75rem; padding: 0.75rem; border-radius: 6px; }
    .action-script { background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.2); }
    .action-random { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); }
    .action-title { font-size: 0.8rem; font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .action-script .action-title { color: #f97316; }
    .action-random .action-title { color: #3b82f6; }
    .action-badge { font-size: 0.65rem; padding: 0.2rem 0.5rem; border-radius: 4px; }
    .action-script .action-badge { background: rgba(249, 115, 22, 0.2); }
    .action-random .action-badge { background: rgba(59, 130, 246, 0.2); }
    .action-text { font-size: 0.85rem; color: #e5e7eb; line-height: 1.5; }
    .history-stats { display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.75rem; }
    .history-stat { padding: 0.25rem 0.5rem; background: #1f2937; border-radius: 4px; }
    .progress-bar { height: 8px; background: #374151; border-radius: 4px; overflow: hidden; margin-top: 0.5rem; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #22d3ee); }
    .job-header { cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; margin: -1rem; margin-bottom: 0; border-radius: 8px; transition: background 0.2s; }
    .job-header:hover { background: rgba(255,255,255,0.05); }
    .job-toggle { font-size: 0.75rem; color: #9ca3af; display: flex; align-items: center; gap: 0.5rem; }
    .job-toggle-icon { transition: transform 0.2s; display: inline-block; }
    .job-toggle-icon.expanded { transform: rotate(90deg); }
    .job-content { display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #374151; }
    .job-content.expanded { display: block; }
    .expand-all-btn { padding: 0.5rem 1rem; background: #374151; color: #e5e7eb; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; margin-bottom: 1rem; }
    .expand-all-btn:hover { background: #4b5563; }
    @media print {
      body { background: white; color: black; }
      .user-card, .job { border: 1px solid #ccc; background: #f9f9f9; }
      .failure { background: #fff5f5; }
      .analysis-section { background: #f5f3ff; }
      .action-section { background: #f0f9ff; }
      .job-content { display: block !important; }
      .job-toggle { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Results Report</h1>
    <p class="timestamp">Generated: ${timestamp}</p>

    <!-- Summary -->
    <div class="summary">
      <div class="summary-card">
        <div class="summary-value" style="color: #22d3ee;">${data.length}</div>
        <div class="summary-label">Users</div>
      </div>
      <div class="summary-card">
        <div class="summary-value" style="color: #f3f4f6;">${data.reduce((a, u) => a + u.jobs.length, 0)}</div>
        <div class="summary-label">Jobs</div>
      </div>
      <div class="summary-card">
        <div class="summary-value" style="color: #22c55e;">${data.reduce((a, u) => a + u.jobs.reduce((b, j) => b + j.passed, 0), 0)}</div>
        <div class="summary-label">Tests Passed</div>
      </div>
      <div class="summary-card">
        <div class="summary-value" style="color: #ef4444;">${data.reduce((a, u) => a + u.jobs.reduce((b, j) => b + j.failed, 0), 0)}</div>
        <div class="summary-label">Tests Failed</div>
      </div>
    </div>

    <button id="expand-all-btn" class="expand-all-btn" onclick="toggleAll()">Expand All Jobs</button>

    ${data.map(user => `
      <div class="user-card">
        <div class="user-header">
          <div>
            <span class="user-email">${escapeHtml(user.email)}</span>
            ${user.name ? `<div style="font-size: 0.875rem; color: #9ca3af;">${escapeHtml(user.name)}</div>` : ''}
          </div>
          <div class="stats">
            <span class="stat stat-pass">${user.jobs.reduce((a, j) => a + j.passed, 0)} Passed</span>
            <span class="stat stat-fail">${user.jobs.reduce((a, j) => a + j.failed, 0)} Failed</span>
          </div>
        </div>

        ${user.jobs.map((job, jobIndex) => {
          const jobId = 'job-' + Buffer.from(user.email).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + '-' + jobIndex;
          return `
          <div class="job" data-job-id="${jobId}">
            <div class="job-header" onclick="toggleJob('${jobId}')">
              <div>
                <div class="job-name">${escapeHtml(job.name)}</div>
                ${job.description ? `<div class="job-desc">${escapeHtml(job.description)}</div>` : ''}
                <div class="job-stats">
                  ${job.passed}/${job.total} passed (${job.passRate}%) • Last run: ${new Date(job.lastRun).toLocaleString()}
                  ${job.failed > 0 ? ` • <span style="color: #ef4444;">${job.failed} failed</span>` : ''}
                </div>
                <div class="progress-bar" style="margin-top: 0.5rem;">
                  <div class="progress-fill" style="width: ${job.passRate}%"></div>
                </div>
              </div>
              <div class="job-toggle">
                <span>Click to expand</span>
                <span class="job-toggle-icon" id="icon-${jobId}">▶</span>
              </div>
            </div>

            <div class="job-content" id="content-${jobId}">
              ${job.failures.length > 0 ? `
                <div class="failures">
                  <div style="font-size: 0.8rem; color: #f87171; font-weight: 600; margin-bottom: 0.5rem;">
                    Failed Tests (${job.failures.length})
                  </div>
                  ${job.failures.map(f => `
                    <div class="failure">
                      <div class="failure-header">
                        <div>
                          <div class="failure-title">${escapeHtml(f.title)}</div>
                          <div class="failure-file">${escapeHtml(f.fileName)}</div>
                        </div>
                        <span class="failure-status ${f.analysisStatus === 'completed' ? 'status-completed' : 'status-pending'}">
                          ${f.analysisStatus === 'completed' ? '✓ Analyzed' : '⏳ Pending'}
                        </span>
                      </div>

                      ${f.error || f.fullError ? `
                        <div class="error-section">
                          <div class="error-label">Error</div>
                          <div class="error-box">${escapeHtml(f.error || f.fullError)}</div>
                        </div>
                      ` : ''}

                      ${f.stackError ? `
                        <div class="error-section">
                          <div class="error-label">Stack Trace</div>
                          <div class="error-box">${escapeHtml(f.stackError)}</div>
                        </div>
                      ` : ''}

                      ${f.rootCause || f.suggestedFix ? `
                        <div class="analysis-section">
                          <div class="analysis-title">🤖 AI Analysis</div>
                          ${f.rootCause ? `
                            <div class="analysis-item">
                              <div class="analysis-label">Root Cause</div>
                              <div class="analysis-text">${formatText(f.rootCause)}</div>
                            </div>
                          ` : ''}
                          ${f.suggestedFix ? `
                            <div class="analysis-item">
                              <div class="analysis-label">Suggested Fix</div>
                              <div class="analysis-text">${formatText(f.suggestedFix)}</div>
                            </div>
                          ` : ''}
                          ${f.possibleCodeFix ? `
                            <div class="analysis-item">
                              <div class="analysis-label">Code Fix</div>
                              <div class="code-fix">${escapeHtml(f.possibleCodeFix)}</div>
                            </div>
                          ` : ''}
                        </div>
                      ` : ''}

                      ${f.actionTaken ? `
                        <div class="action-section ${f.actionTaken.type === 'script_issue' ? 'action-script' : 'action-random'}">
                          <div class="action-title">
                            ${f.actionTaken.type === 'script_issue' ? '🔧' : '🎲'}
                            Action Taken
                            <span class="action-badge">
                              ${f.actionTaken.type === 'script_issue' ? 'Script/Application Issue' : 'Random Failure'}
                            </span>
                          </div>
                          <div class="action-text">${formatText(f.actionTaken.explanation)}</div>
                          ${f.actionTaken.historyChecked ? `
                            <div class="history-stats">
                              <span class="history-stat">Last 3 runs:</span>
                              <span class="history-stat" style="color: #f3f4f6;">${f.actionTaken.historyChecked.totalRuns} total</span>
                              <span class="history-stat" style="color: #ef4444;">${f.actionTaken.historyChecked.failedRuns} failed</span>
                              <span class="history-stat" style="color: #22c55e;">${f.actionTaken.historyChecked.passedRuns} passed</span>
                            </div>
                          ` : ''}
                        </div>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="text-align: center; padding: 1rem; color: #22c55e;">
                  ✓ All tests passed!
                </div>
              `}
            </div>
          </div>
        `}).join('')}
      </div>
    `).join('')}
  </div>

  <script>
    let allExpanded = false;

    function toggleJob(jobId) {
      const content = document.getElementById('content-' + jobId);
      const icon = document.getElementById('icon-' + jobId);

      if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        icon.classList.remove('expanded');
      } else {
        content.classList.add('expanded');
        icon.classList.add('expanded');
      }
    }

    function toggleAll() {
      const contents = document.querySelectorAll('.job-content');
      const icons = document.querySelectorAll('.job-toggle-icon');
      const btn = document.getElementById('expand-all-btn');

      allExpanded = !allExpanded;

      contents.forEach(content => {
        if (allExpanded) {
          content.classList.add('expanded');
        } else {
          content.classList.remove('expanded');
        }
      });

      icons.forEach(icon => {
        if (allExpanded) {
          icon.classList.add('expanded');
        } else {
          icon.classList.remove('expanded');
        }
      });

      btn.textContent = allExpanded ? 'Collapse All Jobs' : 'Expand All Jobs';
    }
  </script>
</body>
</html>
  `;
}

// Get cached AI summary for a job's failures (public - read only, no generation)
router.get('/job-summary/:jobId', async (req, res) => {
  try {
    // Get job with cached summary
    const job = await Job.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get the latest execution for this job
    const latestResult = await TestResult.findOne({
      job: req.params.jobId
    }).sort({ timestamp: -1 });

    if (!latestResult) {
      return res.status(404).json({ error: 'No results found for this job' });
    }

    // Return cached summary if available and matches current execution
    if (job.failureSummary?.executionId === latestResult.executionId && job.failureSummary?.summary) {
      return res.json({
        summary: job.failureSummary.summary,
        failureCount: job.failureSummary.failureCount,
        executionId: job.failureSummary.executionId,
        generatedAt: job.failureSummary.generatedAt,
        cached: true
      });
    }

    // No cached summary available - return null (summary should be generated from JobDetails page)
    const failedCount = await TestResult.countDocuments({
      job: req.params.jobId,
      executionId: latestResult.executionId,
      state: 'failed'
    });

    if (failedCount === 0) {
      return res.json({ summary: null, message: 'No failures to summarize' });
    }

    res.json({
      summary: null,
      message: 'Summary not yet generated. View job details to generate summary.',
      failureCount: failedCount,
      executionId: latestResult.executionId
    });
  } catch (error) {
    console.error('Job summary error:', error.message);
    res.status(500).json({ error: 'Failed to get summary: ' + error.message });
  }
});

module.exports = router;
