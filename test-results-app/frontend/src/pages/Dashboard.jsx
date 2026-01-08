import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { jobsAPI, analysisAPI } from '../services/api';
import AnalysisWorkflow from '../components/AnalysisWorkflow';

const Dashboard = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(null);
  const [showWorkflow, setShowWorkflow] = useState(false);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await jobsAPI.getAll();
      setJobs(res.data.jobs || []);
    } catch (err) {
      setError('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async (jobId) => {
    setAnalyzing(jobId);
    setShowWorkflow(true);
    try {
      await analysisAPI.analyzeJob(jobId);
      await fetchJobs();
    } catch (err) {
      setError('Analysis failed');
      setShowWorkflow(false);
    }
  };

  const handleWorkflowComplete = () => {
    setShowWorkflow(false);
    setAnalyzing(null);
  };

  const getStatusColor = (stats) => {
    if (!stats || stats.total === 0) return 'text-gray-400';
    if (stats.failed === 0) return 'text-green-400';
    if (stats.passed === 0) return 'text-red-400';
    return 'text-yellow-400';
  };

  const getStatusIcon = (stats) => {
    if (!stats || stats.total === 0) return '⚪';
    if (stats.failed === 0) return '✅';
    if (stats.passed === 0) return '❌';
    return '⚠️';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Your Jobs</h2>
        <Link
          to="/dashboard/jobs/new"
          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-gray-900 font-semibold rounded-lg transition"
        >
          + New Job
        </Link>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-12 text-center">
          <span className="text-6xl">📋</span>
          <h3 className="text-xl font-semibold text-white mt-4">No jobs yet</h3>
          <p className="text-gray-400 mt-2">Create your first job to start tracking test results</p>
          <Link
            to="/dashboard/jobs/new"
            className="inline-block mt-6 px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-gray-900 font-semibold rounded-lg transition"
          >
            Create Job
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job) => (
            <div
              key={job._id}
              className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-gray-600 transition"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <Link
                    to={`/dashboard/jobs/${job._id}`}
                    className="text-xl font-semibold text-white hover:text-cyan-400 transition"
                  >
                    {job.name}
                  </Link>
                  {job.description && (
                    <p className="text-gray-400 mt-1">{job.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3">
                    <span className="text-sm text-gray-500">
                      {job.files?.length || 0} files
                    </span>
                    {job.stats?.total > 0 && (
                      <>
                        <span className={`text-sm ${getStatusColor(job.stats)}`}>
                          {getStatusIcon(job.stats)} {job.stats.passed} passed, {job.stats.failed} failed
                        </span>
                        {formatDate(job.stats.lastRun) && (
                          <span className="text-sm text-gray-500">
                            {formatDate(job.stats.lastRun)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {job.stats?.failed > 0 && (
                    <button
                      onClick={() => handleAnalyze(job._id)}
                      disabled={analyzing === job._id}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                    >
                      {analyzing === job._id ? 'Analyzing...' : 'Analyze with AI'}
                    </button>
                  )}
                  <Link
                    to={`/dashboard/jobs/${job._id}`}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnalysisWorkflow
        isActive={showWorkflow}
        onComplete={handleWorkflowComplete}
      />
    </div>
  );
};

export default Dashboard;
