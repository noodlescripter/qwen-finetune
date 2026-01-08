import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { jobsAPI, resultsAPI, analysisAPI } from '../services/api';
import AnalysisWorkflow from '../components/AnalysisWorkflow';

// Helper function to format AI response text with proper styling
const formatAIText = (text) => {
  if (!text) return null;

  // Split by newlines and process each line
  const lines = text.split('\n');

  return lines.map((line, index) => {
    const trimmedLine = line.trim();

    // Empty line
    if (!trimmedLine) {
      return <div key={index} className="h-2" />;
    }

    // Numbered items (1. 2. 3. etc)
    if (/^\d+[\.\)]\s/.test(trimmedLine)) {
      const match = trimmedLine.match(/^(\d+[\.\)])\s(.*)$/);
      return (
        <div key={index} className="mt-2 flex gap-2">
          <span className="text-purple-400 font-semibold">{match[1]}</span>
          <span>{match[2]}</span>
        </div>
      );
    }

    // Letter items (a) b) c) etc)
    if (/^[a-z][\.\)]\s/i.test(trimmedLine)) {
      const match = trimmedLine.match(/^([a-z][\.\)])\s(.*)$/i);
      return (
        <div key={index} className="mt-1 ml-6 flex gap-2">
          <span className="text-cyan-400 font-medium">{match[1]}</span>
          <span>{match[2]}</span>
        </div>
      );
    }

    // Bullet points (- or *)
    if (/^[-\*]\s/.test(trimmedLine)) {
      return (
        <div key={index} className="mt-1 ml-4 flex gap-2">
          <span className="text-green-400">•</span>
          <span>{trimmedLine.substring(2)}</span>
        </div>
      );
    }

    // Regular text
    return <div key={index} className="mt-1">{trimmedLine}</div>;
  });
};

const JobDetails = () => {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(null);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [expandedResult, setExpandedResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const [jobRes, resultsRes] = await Promise.all([
        jobsAPI.getById(id),
        resultsAPI.getLatestByJob(id),
      ]);
      setJob(jobRes.data.job);
      const fetchedResults = resultsRes.data.results || [];
      setResults(fetchedResults);

      // Check if there's a cached summary (don't generate, just fetch cached)
      const hasFailed = fetchedResults.some(r => r.state === 'failed');
      if (hasFailed) {
        try {
          const summaryRes = await analysisAPI.getJobSummary(id, false);
          if (summaryRes.data.summary) {
            setSummary(summaryRes.data.summary);
          }
        } catch (err) {
          // No cached summary available, that's fine
        }
      }
    } catch (err) {
      setError('Failed to load job details');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async (regenerate = false) => {
    setLoadingSummary(true);
    try {
      const res = await analysisAPI.getJobSummary(id, regenerate);
      setSummary(res.data.summary);
    } catch (err) {
      console.error('Failed to fetch summary');
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleAnalyzeResult = async (resultId) => {
    setAnalyzing(resultId);
    setShowWorkflow(true);
    try {
      await analysisAPI.analyzeResult(resultId);
      await fetchData();
    } catch (err) {
      setError('Analysis failed');
      setShowWorkflow(false);
    }
  };

  const handleAnalyzeAll = async () => {
    setAnalyzing('all');
    setShowWorkflow(true);
    try {
      await analysisAPI.analyzeJob(id);
      await fetchData();
    } catch (err) {
      setError('Analysis failed');
      setShowWorkflow(false);
    }
  };

  const handleWorkflowComplete = () => {
    setShowWorkflow(false);
    setAnalyzing(null);
  };

  const getStateColor = (state) => {
    switch (state) {
      case 'passed': return 'text-green-400 bg-green-400/10';
      case 'failed': return 'text-red-400 bg-red-400/10';
      case 'skipped': return 'text-yellow-400 bg-yellow-400/10';
      default: return 'text-gray-400 bg-gray-400/10';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-white">Job not found</h2>
        <Link to="/dashboard" className="text-cyan-400 hover:underline mt-4 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const failedResults = results.filter(r => r.state === 'failed');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link to="/dashboard" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">
            &larr; Back to Dashboard
          </Link>
          <h2 className="text-2xl font-bold text-white">{job.name}</h2>
          {job.description && (
            <p className="text-gray-400 mt-1">{job.description}</p>
          )}
        </div>
        {failedResults.length > 0 && (
          <button
            onClick={handleAnalyzeAll}
            disabled={analyzing === 'all'}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-2"
          >
            {analyzing === 'all' ? (
              <>
                <span className="animate-spin">⏳</span> Analyzing All...
              </>
            ) : (
              <>
                <span>🤖</span> Analyze All Failures ({failedResults.length})
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-white">{results.length}</div>
          <div className="text-gray-400 text-sm">Total Tests</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-400">
            {results.filter(r => r.state === 'passed').length}
          </div>
          <div className="text-gray-400 text-sm">Passed</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-red-400">{failedResults.length}</div>
          <div className="text-gray-400 text-sm">Failed</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-yellow-400">
            {results.filter(r => r.state === 'skipped').length}
          </div>
          <div className="text-gray-400 text-sm">Skipped</div>
        </div>
      </div>

      {/* AI Summary Section - Only show when there are failures */}
      {failedResults.length > 0 && (
        <div className="bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/30 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">📋</span>
            <h3 className="text-lg font-semibold text-white">Critical Failures Summary</h3>
            {loadingSummary && (
              <span className="animate-spin text-purple-400">⏳</span>
            )}
            <button
              onClick={() => fetchSummary(true)}
              disabled={loadingSummary}
              className="ml-auto px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg flex items-center gap-1 disabled:opacity-50 transition"
            >
              {loadingSummary ? (
                <>⏳ Generating...</>
              ) : summary ? (
                <>🔄 Regenerate</>
              ) : (
                <>✨ Generate Summary</>
              )}
            </button>
          </div>
          {loadingSummary ? (
            <div className="text-gray-400 text-sm">Analyzing failures and generating summary...</div>
          ) : summary ? (
            <div className="text-gray-200">{formatAIText(summary)}</div>
          ) : (
            <div className="text-gray-400 text-sm">
              Click "Generate Summary" to get an AI analysis of critical failures.
            </div>
          )}
        </div>
      )}

      {/* Results List */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Test Results</h3>
        </div>

        {results.length === 0 ? (
          <div className="p-12 text-center">
            <span className="text-4xl">📭</span>
            <p className="text-gray-400 mt-4">No test results yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {results.map((result) => (
              <div key={result._id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStateColor(result.state)}`}>
                        {result.state.toUpperCase()}
                      </span>
                      <span className="text-white font-medium">{result.title}</span>
                    </div>
                    <div className="text-gray-500 text-sm mt-1">
                      {result.fileName} • {result.duration}ms
                    </div>

                    {result.state === 'failed' && (result.error || result.fullError) && (
                      <div className="mt-3">
                        <button
                          onClick={() => setExpandedResult(expandedResult === result._id ? null : result._id)}
                          className="text-cyan-400 text-sm hover:underline"
                        >
                          {expandedResult === result._id ? 'Hide Details' : 'Show Details'}
                        </button>

                        {expandedResult === result._id && (
                          <div className="mt-3 space-y-4">
                            {/* Error Section */}
                            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                              <h4 className="text-red-400 font-semibold mb-3 flex items-center gap-2">
                                <span>Error Details</span>
                              </h4>

                              {result.error && (
                                <div className="mb-3">
                                  <span className="text-gray-400 text-xs uppercase tracking-wide">Error Message</span>
                                  <div className="mt-1 text-red-300 font-mono text-sm bg-gray-900 rounded p-3">
                                    {result.error}
                                  </div>
                                </div>
                              )}

                              {result.fullError && (
                                <div className="mb-3">
                                  <span className="text-gray-400 text-xs uppercase tracking-wide">Full Error</span>
                                  <pre className="mt-1 text-red-300/80 font-mono text-xs bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap">
                                    {result.fullError}
                                  </pre>
                                </div>
                              )}

                              {result.stackError && (
                                <div className="mb-3">
                                  <span className="text-gray-400 text-xs uppercase tracking-wide">Stack Trace</span>
                                  <pre className="mt-1 text-gray-400 font-mono text-xs bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                                    {result.stackError}
                                  </pre>
                                </div>
                              )}

                              {result.completeError && !result.stackError && (
                                <div>
                                  <span className="text-gray-400 text-xs uppercase tracking-wide">Complete Error</span>
                                  <pre className="mt-1 text-gray-400 font-mono text-xs bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                                    {result.completeError}
                                  </pre>
                                </div>
                              )}
                            </div>

                            {/* AI Analysis Section */}
                            {result.analysis?.status === 'completed' && (
                              <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4">
                                <h4 className="text-purple-400 font-semibold mb-3 flex items-center gap-2">
                                  <span>AI Analysis</span>
                                </h4>
                                <div className="space-y-3">
                                  <div>
                                    <span className="text-gray-400 text-xs uppercase tracking-wide">Root Cause</span>
                                    <div className="mt-1 text-white">
                                      {formatAIText(result.analysis.rootCause)}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 text-xs uppercase tracking-wide">Suggested Fix</span>
                                    <div className="mt-1 text-white">
                                      {formatAIText(result.analysis.suggestedFix)}
                                    </div>
                                  </div>
                                  {result.analysis.possibleCodeFix && (
                                    <div>
                                      <span className="text-gray-400 text-xs uppercase tracking-wide">Code Fix</span>
                                      <pre className="mt-1 bg-gray-900 rounded p-3 text-green-400 text-sm overflow-x-auto">
                                        {result.analysis.possibleCodeFix}
                                      </pre>
                                    </div>
                                  )}
                                  {result.analysis.locations?.length > 0 && (
                                    <div>
                                      <span className="text-gray-400 text-xs uppercase tracking-wide">Error Location</span>
                                      {result.analysis.locations.map((loc, i) => (
                                        <div key={i} className="mt-1 bg-gray-900 rounded p-3">
                                          <div className="text-cyan-400 text-sm mb-2">
                                            {loc.file}:{loc.line}
                                          </div>
                                          {loc.code && (
                                            <pre className="text-gray-300 text-xs overflow-x-auto">
                                              {loc.code}
                                            </pre>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Action Taken Section */}
                            {result.actionTaken?.status === 'completed' && (
                              <div className={`rounded-lg p-4 ${
                                result.actionTaken.type === 'script_issue'
                                  ? 'bg-orange-500/5 border border-orange-500/20'
                                  : 'bg-blue-500/5 border border-blue-500/20'
                              }`}>
                                <h4 className={`font-semibold mb-3 flex items-center gap-2 ${
                                  result.actionTaken.type === 'script_issue'
                                    ? 'text-orange-400'
                                    : 'text-blue-400'
                                }`}>
                                  <span>{result.actionTaken.type === 'script_issue' ? '🔧' : '🎲'}</span>
                                  <span>Action Taken</span>
                                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                                    result.actionTaken.type === 'script_issue'
                                      ? 'bg-orange-500/20 text-orange-300'
                                      : 'bg-blue-500/20 text-blue-300'
                                  }`}>
                                    {result.actionTaken.type === 'script_issue' ? 'Script/Application Issue' : 'Random Failure'}
                                  </span>
                                </h4>
                                <div className="space-y-3">
                                  <div>
                                    <span className="text-gray-400 text-xs uppercase tracking-wide">Explanation</span>
                                    <div className="mt-1 text-white">
                                      {formatAIText(result.actionTaken.explanation)}
                                    </div>
                                  </div>
                                  {result.actionTaken.historyChecked && (
                                    <div>
                                      <span className="text-gray-400 text-xs uppercase tracking-wide">History Analysis (Last 3 Runs)</span>
                                      <div className="mt-2 grid grid-cols-3 gap-2">
                                        <div className="bg-gray-900 rounded p-2 text-center">
                                          <div className="text-lg font-bold text-white">
                                            {result.actionTaken.historyChecked.totalRuns}
                                          </div>
                                          <div className="text-xs text-gray-500">Total Runs</div>
                                        </div>
                                        <div className="bg-gray-900 rounded p-2 text-center">
                                          <div className="text-lg font-bold text-red-400">
                                            {result.actionTaken.historyChecked.failedRuns}
                                          </div>
                                          <div className="text-xs text-gray-500">Failed</div>
                                        </div>
                                        <div className="bg-gray-900 rounded p-2 text-center">
                                          <div className="text-lg font-bold text-green-400">
                                            {result.actionTaken.historyChecked.passedRuns}
                                          </div>
                                          <div className="text-xs text-gray-500">Passed</div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {result.analysis?.status === 'pending' && (
                              <div className="bg-gray-800 rounded-lg p-4 text-center">
                                <span className="text-gray-400">Analysis pending - click "Analyze" to get AI insights</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {result.state === 'failed' && result.analysis?.status !== 'completed' && (
                    <button
                      onClick={() => handleAnalyzeResult(result._id)}
                      disabled={analyzing === result._id}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-2"
                    >
                      {analyzing === result._id ? (
                        <>
                          <span className="animate-spin">⏳</span> Analyzing...
                        </>
                      ) : (
                        <>
                          <span>🤖</span> Let AI Decide
                        </>
                      )}
                    </button>
                  )}
                  {result.state === 'failed' && result.analysis?.status === 'completed' && (
                    <span className="px-3 py-1 bg-green-500/20 text-green-400 text-sm rounded-lg flex items-center gap-1">
                      <span>✓</span> Analyzed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnalysisWorkflow
        isActive={showWorkflow}
        onComplete={handleWorkflowComplete}
      />
    </div>
  );
};

export default JobDetails;
