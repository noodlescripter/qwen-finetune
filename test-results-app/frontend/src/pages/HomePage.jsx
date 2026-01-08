import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { publicAPI } from '../services/api';
import AnalysisWorkflow from '../components/AnalysisWorkflow';

// Helper function to format AI response text with proper styling
const formatAIText = (text, compact = false) => {
  if (!text) return null;

  const lines = text.split('\n');

  return lines.map((line, index) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return compact ? null : <div key={index} className="h-1" />;
    }

    // Numbered items (1. 2. 3. etc)
    if (/^\d+[\.\)]\s/.test(trimmedLine)) {
      const match = trimmedLine.match(/^(\d+[\.\)])\s(.*)$/);
      return (
        <div key={index} className={`${compact ? 'mt-1' : 'mt-2'} flex gap-1`}>
          <span className="text-purple-400 font-semibold">{match[1]}</span>
          <span>{match[2]}</span>
        </div>
      );
    }

    // Letter items (a) b) c) etc)
    if (/^[a-z][\.\)]\s/i.test(trimmedLine)) {
      const match = trimmedLine.match(/^([a-z][\.\)])\s(.*)$/i);
      return (
        <div key={index} className="mt-1 ml-4 flex gap-1">
          <span className="text-cyan-400">{match[1]}</span>
          <span>{match[2]}</span>
        </div>
      );
    }

    // Bullet points (- or *)
    if (/^[-\*]\s/.test(trimmedLine)) {
      return (
        <div key={index} className="mt-1 ml-2 flex gap-1">
          <span className="text-green-400">•</span>
          <span>{trimmedLine.substring(2)}</span>
        </div>
      );
    }

    // Regular text
    return <span key={index}>{index > 0 ? ' ' : ''}{trimmedLine}</span>;
  });
};

const HomePage = () => {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState({});
  const [expandedJobs, setExpandedJobs] = useState({});
  const [jobSummaries, setJobSummaries] = useState({});
  const [loadingSummaries, setLoadingSummaries] = useState({});
  const [filters, setFilters] = useState({
    email: '',
    jobName: '',
    state: ''
  });
  const [analyzing, setAnalyzing] = useState(null);
  const [showWorkflow, setShowWorkflow] = useState(false);

  // Fetch results with current filters
  const fetchResults = async (currentFilters = filters, isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    } else {
      setFiltering(true);
    }
    try {
      const params = {};
      if (currentFilters.email) params.email = currentFilters.email;
      if (currentFilters.jobName) params.jobName = currentFilters.jobName;
      if (currentFilters.state) params.state = currentFilters.state;

      const res = await publicAPI.getResults(params);
      const newResults = res.data.results || [];
      setResults(newResults);
      // Expand all email rows by default
      const expandedEmails = {};
      newResults.forEach(r => { expandedEmails[r.email] = true; });
      setExpandedRows(expandedEmails);

      // Auto-fetch summaries for all jobs with failures
      newResults.forEach(r => {
        r.jobs?.forEach(job => {
          if (job.failed > 0) {
            fetchJobSummary(job._id);
          }
        });
      });
    } catch (err) {
      setError('Failed to load results');
    } finally {
      setLoading(false);
      setFiltering(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchResults(filters, true);
  }, []);

  // Debounced auto-search as user types
  useEffect(() => {
    // Skip on initial mount
    if (loading) return;

    const timer = setTimeout(() => {
      fetchResults(filters);
    }, 300);

    return () => clearTimeout(timer);
  }, [filters.email, filters.jobName, filters.state]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      fetchResults();
    }
  };

  const handleClearFilters = () => {
    setFilters({ email: '', jobName: '', state: '' });
  };

  const toggleRow = (email) => {
    const isExpanding = !expandedRows[email];
    setExpandedRows(prev => ({
      ...prev,
      [email]: !prev[email]
    }));

    // Auto-fetch summaries for all jobs with failures when expanding
    if (isExpanding) {
      const userResult = results.find(r => r.email === email);
      userResult?.jobs?.forEach(job => {
        if (job.failed > 0 && !jobSummaries[job._id] && !loadingSummaries[job._id]) {
          fetchJobSummary(job._id);
        }
      });
    }
  };

  const toggleJob = (jobId) => {
    setExpandedJobs(prev => ({
      ...prev,
      [jobId]: !prev[jobId]
    }));
  };

  const fetchJobSummary = async (jobId) => {
    if (jobSummaries[jobId] || loadingSummaries[jobId]) return;

    setLoadingSummaries(prev => ({ ...prev, [jobId]: true }));
    try {
      const res = await publicAPI.getJobSummary(jobId);
      setJobSummaries(prev => ({ ...prev, [jobId]: res.data.summary }));
    } catch (err) {
      console.error('Failed to fetch job summary');
    } finally {
      setLoadingSummaries(prev => ({ ...prev, [jobId]: false }));
    }
  };

  const handleAnalyzeUser = async (email) => {
    setAnalyzing(email);
    setShowWorkflow(true);
    try {
      await publicAPI.analyzeUser(email);
      await fetchResults();
    } catch (err) {
      setError('Analysis failed');
    } finally {
      setShowWorkflow(false);
      setAnalyzing(null);
    }
  };

  const handleDownload = (email = null) => {
    window.open(publicAPI.downloadReport(email), '_blank');
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  };

  const getPassRateColor = (rate) => {
    const r = parseFloat(rate);
    if (r >= 80) return 'text-green-400';
    if (r >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">Completed</span>;
      case 'partial':
        return <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">Partial</span>;
      case 'pending':
        return <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-full animate-pulse">Pending</span>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🧪</span>
            <h1 className="text-xl font-bold text-cyan-400">Test Results Overview</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleDownload()}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition flex items-center gap-2"
            >
              <span>📥</span> Download All Reports
            </button>
            <Link
              to="/login"
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition"
            >
              Login
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6" style={{ minWidth: '1920px' }}>
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="flex gap-4">
          {/* Left side - Filters and Table */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {/* Filters */}
            <div className="bg-gray-800 rounded-xl p-4 mb-6">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                  <input
                    type="text"
                    value={filters.email}
                    onChange={(e) => setFilters(prev => ({ ...prev, email: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="Search by email..."
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-white"
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Job Name</label>
                  <input
                    type="text"
                    value={filters.jobName}
                    onChange={(e) => setFilters(prev => ({ ...prev, jobName: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="Search by job name..."
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-white"
                  />
                </div>
                <div className="w-40">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Status</label>
                  <select
                    value={filters.state}
                    onChange={(e) => setFilters(prev => ({ ...prev, state: e.target.value }))}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-white"
                  >
                    <option value="">All</option>
                    <option value="passed">All Passing</option>
                    <option value="failed">Has Failures</option>
                  </select>
                </div>
                <button
                  onClick={handleClearFilters}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition"
                >
                  Clear
                </button>
                {filtering && (
                  <div className="flex items-center gap-2 text-cyan-400 text-sm">
                    <div className="animate-spin h-4 w-4 border-2 border-cyan-400 border-t-transparent rounded-full"></div>
                    <span>Searching...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Results Table */}
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-700/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Analysis</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Pass Rate</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Fail Rate</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Tests</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {results.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="px-4 py-12 text-center text-gray-400">
                          No results found
                        </td>
                      </tr>
                    ) : (
                      results.map((result) => (
                        <>
                          {/* Main Row */}
                          <tr
                            key={result.email}
                            className={`hover:bg-gray-700/30 cursor-pointer ${result.analysisStatus === 'pending' ? 'bg-red-500/5' : ''}`}
                            onClick={() => toggleRow(result.email)}
                          >
                            <td className="px-4 py-4">
                              <span className={`transition-transform inline-block ${expandedRows[result.email] ? 'rotate-90' : ''}`}>
                                ▶
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <div className="text-cyan-400 font-medium">{result.email}</div>
                              <div className="text-gray-500 text-sm">{result.jobs?.length || 0} jobs</div>
                            </td>
                            <td className="px-4 py-4">
                              {getStatusBadge(result.analysisStatus)}
                              {result.totalPending > 0 && (
                                <div className="text-gray-500 text-xs mt-1">
                                  {result.totalPending} pending
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <span className={`text-lg font-bold ${getPassRateColor(result.passRate)}`}>
                                {result.passRate}%
                              </span>
                              <div className="text-gray-500 text-xs">{result.totalPassed} passed</div>
                            </td>
                            <td className="px-4 py-4">
                              <span className={`text-lg font-bold ${parseFloat(result.failRate) > 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                {result.failRate}%
                              </span>
                              <div className="text-gray-500 text-xs">{result.totalFailed} failed</div>
                            </td>
                            <td className="px-4 py-4 text-white">
                              {result.totalTests}
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                {result.analysisStatus !== 'completed' && result.totalFailed > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAnalyzeUser(result.email);
                                    }}
                                    disabled={analyzing === result.email}
                                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-1"
                                  >
                                    {analyzing === result.email ? (
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

                                {(() => {
                                  if (result.analysisStatus === 'Completed' || result.analysisStatus === 'completed') {
                                    return (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDownload(result.email);
                                        }}
                                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition"
                                      >
                                        📥 Download
                                      </button>
                                    )
                                  } else {
                                    return (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDownload(result.email);
                                        }}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition"
                                      >
                                        Notify Owner 
                                      </button>
                                    )
                                  }
                                })()}

                              </div>
                            </td>
                          </tr>

                          {/* Expanded Row - Job Details */}
                          {expandedRows[result.email] && (
                            <tr className="bg-gray-900/50">
                              <td colSpan="7" className="px-4 py-4">
                                <div className="pl-8 space-y-3">
                                  <h4 className="text-cyan-400 font-semibold mb-3">Jobs ({result.jobs?.length || 0})</h4>
                                  {result.jobs?.map((job) => (
                                    <div key={job._id} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                                      {/* Job Header - Clickable to expand */}
                                      <div
                                        className="p-4 cursor-pointer hover:bg-gray-700/30 transition"
                                        onClick={() => toggleJob(job._id)}
                                      >
                                        <div className="flex items-start justify-between">
                                          <div className="flex items-center gap-3">
                                            <span className={`transition-transform ${expandedJobs[job._id] ? 'rotate-90' : ''}`}>
                                              ▶
                                            </span>
                                            <div>
                                              <div className="flex items-center gap-2">
                                                <h5 className="text-white font-medium">{job.name}</h5>
                                                {job.pendingCount > 0 ? (
                                                  <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">
                                                    {job.pendingCount} pending
                                                  </span>
                                                ) : job.failed > 0 ? (
                                                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                                                    ✓ Analyzed
                                                  </span>
                                                ) : null}
                                              </div>
                                              <p className="text-gray-500 text-sm">
                                                {job.files?.join(', ')} • {formatDate(job.lastRun)}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-4 text-sm">
                                            <span className="text-green-400">{job.passed} passed</span>
                                            <span className="text-red-400">{job.failed} failed</span>
                                            <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                                              <div
                                                className="h-full bg-gradient-to-r from-green-500 to-cyan-500"
                                                style={{ width: `${job.passRate}%` }}
                                              />
                                            </div>
                                            <span className={getPassRateColor(job.passRate)}>{job.passRate}%</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* AI Summary for Job - Always visible if has failures */}
                                      {job.failed > 0 && (
                                        <div className="border-t border-gray-700 px-4 py-3 bg-gradient-to-r from-purple-500/5 to-cyan-500/5">
                                          <div className="flex items-center gap-2 mb-2">
                                            <span>📋</span>
                                            <span className="text-purple-400 font-semibold text-sm">Critical Failures Summary</span>
                                          </div>
                                          {loadingSummaries[job._id] ? (
                                            <div className="flex items-center gap-2 text-gray-400 text-sm">
                                              <div className="animate-spin h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full"></div>
                                              <span>Loading summary...</span>
                                            </div>
                                          ) : jobSummaries[job._id] ? (
                                            <div className="text-gray-200 text-sm max-h-32 overflow-y-auto pr-2 scrollbar-thin">
                                              {formatAIText(jobSummaries[job._id], true)}
                                            </div>
                                          ) : (
                                            <div className="text-gray-500 text-sm italic">No summary available</div>
                                          )}
                                        </div>
                                      )}

                                      {/* Job Expanded Content */}
                                      {expandedJobs[job._id] && (
                                        <div className="border-t border-gray-700 p-4 bg-gray-900/30">

                                          {/* Failures List */}
                                          {job.failures?.length > 0 && (
                                            <div className="space-y-2">
                                              <h6 className="text-red-400 text-sm font-medium">Failed Tests ({job.failures.length}):</h6>
                                              {job.failures.map((failure, idx) => (
                                                <div key={failure._id || idx} className="bg-red-500/5 border-l-2 border-red-500 pl-3 py-2">
                                                  <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                      <div className="flex items-center gap-2">
                                                        <div className="text-white text-sm font-medium">{failure.title}</div>
                                                        {failure.analysisStatus === 'completed' ? (
                                                          <span className="text-green-400 text-xs">✓ Analyzed</span>
                                                        ) : (
                                                          <span className="text-yellow-400 text-xs">⏳ Pending</span>
                                                        )}
                                                      </div>
                                                      <div className="text-gray-500 text-xs">{failure.fileName}</div>
                                                    </div>
                                                  </div>

                                                  {failure.error && (
                                                    <div className="mt-1 text-red-300 text-xs font-mono bg-gray-900 p-2 rounded">
                                                      {failure.error}
                                                    </div>
                                                  )}

                                                  {failure.analysisStatus === 'completed' && failure.rootCause && (
                                                    <div className="mt-2 bg-purple-500/10 border border-purple-500/20 rounded p-2">
                                                      <div className="space-y-2">
                                                        <div>
                                                          <span className="text-gray-400 text-xs block mb-1">Root Cause:</span>
                                                          <div className="text-purple-200 text-xs">
                                                            {formatAIText(failure.rootCause, true)}
                                                          </div>
                                                        </div>
                                                        {failure.suggestedFix && (
                                                          <div>
                                                            <span className="text-gray-400 text-xs block mb-1">Fix:</span>
                                                            <div className="text-cyan-200 text-xs">
                                                              {formatAIText(failure.suggestedFix, true)}
                                                            </div>
                                                          </div>
                                                        )}
                                                        {failure.possibleCodeFix && (
                                                          <div className="mt-2">
                                                            <span className="text-gray-400 text-xs">Code Fix:</span>
                                                            <pre className="mt-1 text-green-400 text-xs bg-gray-900 p-2 rounded overflow-x-auto">
                                                              {failure.possibleCodeFix}
                                                            </pre>
                                                          </div>
                                                        )}
                                                      </div>
                                                    </div>
                                                  )}

                                                  {/* Action Taken Section */}
                                                  {failure.actionTaken?.status === 'completed' && (
                                                    <div className={`mt-2 rounded p-2 ${failure.actionTaken.type === 'script_issue'
                                                      ? 'bg-orange-500/10 border border-orange-500/20'
                                                      : 'bg-blue-500/10 border border-blue-500/20'
                                                      }`}>
                                                      <div className="flex items-center gap-2 mb-1">
                                                        <span>{failure.actionTaken.type === 'script_issue' ? '🔧' : '🎲'}</span>
                                                        <span className={`text-xs font-semibold ${failure.actionTaken.type === 'script_issue'
                                                          ? 'text-orange-400'
                                                          : 'text-blue-400'
                                                          }`}>
                                                          Action Taken
                                                        </span>
                                                        <span className={`px-1.5 py-0.5 text-xs rounded ${failure.actionTaken.type === 'script_issue'
                                                          ? 'bg-orange-500/20 text-orange-300'
                                                          : 'bg-blue-500/20 text-blue-300'
                                                          }`}>
                                                          {failure.actionTaken.type === 'script_issue' ? 'Script/App Issue' : 'Random Failure'}
                                                        </span>
                                                      </div>
                                                      <div className="text-gray-300 text-xs">
                                                        {formatAIText(failure.actionTaken.explanation, true)}
                                                      </div>
                                                      {failure.actionTaken.historyChecked && (
                                                        <div className="mt-2 flex items-center gap-3 text-xs">
                                                          <span className="text-gray-500">Last 3 runs:</span>
                                                          <span className="text-white">{failure.actionTaken.historyChecked.totalRuns} total</span>
                                                          <span className="text-red-400">{failure.actionTaken.historyChecked.failedRuns} failed</span>
                                                          <span className="text-green-400">{failure.actionTaken.historyChecked.passedRuns} passed</span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}

                                          {/* No failures message */}
                                          {job.failed === 0 && (
                                            <div className="text-center py-4 text-green-400">
                                              <span className="text-2xl">✓</span>
                                              <p className="mt-1">All tests passed!</p>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right side - Overall Metrics */}
          {results.length > 0 && (() => {
            const totalTests = results.reduce((a, r) => a + r.totalTests, 0);
            const totalPassed = results.reduce((a, r) => a + r.totalPassed, 0);
            const totalFailed = results.reduce((a, r) => a + r.totalFailed, 0);
            const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0;
            const failRate = totalTests > 0 ? ((totalFailed / totalTests) * 100).toFixed(1) : 0;
            const totalJobs = results.reduce((a, r) => a + (r.jobs?.length || 0), 0);
            const pendingAnalysis = results.filter(r => r.analysisStatus === 'pending').length;

            return (
              <div className="w-64 flex-shrink-0">
                <div className="bg-gray-800 rounded-xl p-4 sticky top-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Overall Metrics</h3>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b border-gray-700">
                      <span className="text-gray-400">Users</span>
                      <span className="text-white font-bold text-lg">{results.length}</span>
                    </div>

                    <div className="flex justify-between items-center py-2 border-b border-gray-700">
                      <span className="text-gray-400">Jobs</span>
                      <span className="text-cyan-400 font-bold text-lg">{totalJobs}</span>
                    </div>

                    <div className="flex justify-between items-center py-2 border-b border-gray-700">
                      <span className="text-gray-400">Total Tests</span>
                      <span className="text-white font-bold text-lg">{totalTests}</span>
                    </div>

                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-4">
                      <div className="flex justify-between items-center">
                        <span className="text-green-400">Passed</span>
                        <span className="text-green-400 font-bold text-xl">{totalPassed}</span>
                      </div>
                      <div className="text-green-300 text-2xl font-bold mt-1">{passRate}%</div>
                      <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${passRate}%` }}></div>
                      </div>
                    </div>

                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <span className="text-red-400">Failed</span>
                        <span className="text-red-400 font-bold text-xl">{totalFailed}</span>
                      </div>
                      <div className="text-red-300 text-2xl font-bold mt-1">{failRate}%</div>
                      <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                        <div className="bg-red-500 h-2 rounded-full" style={{ width: `${failRate}%` }}></div>
                      </div>
                    </div>

                    {pendingAnalysis > 0 && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 animate-pulse">
                        <div className="flex justify-between items-center">
                          <span className="text-yellow-400">Pending Analysis</span>
                          <span className="text-yellow-400 font-bold text-xl">{pendingAnalysis}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </main>

      <AnalysisWorkflow
        isActive={showWorkflow}
        onComplete={() => setShowWorkflow(false)}
      />
    </div>
  );
};

export default HomePage;
