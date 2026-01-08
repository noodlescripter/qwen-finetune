import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { jobsAPI, resultsAPI } from '../services/api';

const History = () => {
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await jobsAPI.getAll();
      setJobs(res.data.jobs);
    } catch (err) {
      console.error('Failed to load jobs');
    }
  };

  const fetchHistory = async () => {
    if (!selectedJob && !selectedFile) return;

    setLoading(true);
    try {
      let res;
      const params = {};
      if (dateRange.startDate) params.startDate = dateRange.startDate;
      if (dateRange.endDate) params.endDate = dateRange.endDate;

      if (selectedFile) {
        res = await resultsAPI.getByFile(encodeURIComponent(selectedFile), params);
      } else if (selectedJob) {
        res = await resultsAPI.getHistory(selectedJob, params);
      }

      setHistory(res?.data?.results || []);
    } catch (err) {
      console.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [selectedJob, selectedFile, dateRange]);

  const selectedJobData = jobs.find(j => j._id === selectedJob);

  const getStateColor = (state) => {
    switch (state) {
      case 'passed': return 'text-green-400 bg-green-400/10';
      case 'failed': return 'text-red-400 bg-red-400/10';
      case 'skipped': return 'text-yellow-400 bg-yellow-400/10';
      default: return 'text-gray-400 bg-gray-400/10';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  };

  const groupByExecution = (results) => {
    const groups = {};
    results.forEach(result => {
      const key = result.executionId || result.timestamp;
      if (!groups[key]) {
        groups[key] = {
          executionId: result.executionId,
          timestamp: result.timestamp,
          results: [],
        };
      }
      groups[key].results.push(result);
    });
    return Object.values(groups).sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  };

  const executions = groupByExecution(history);

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Test History</h2>

      {/* Filters */}
      <div className="bg-gray-800 rounded-xl p-6 mb-6">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Job
            </label>
            <select
              value={selectedJob}
              onChange={(e) => {
                setSelectedJob(e.target.value);
                setSelectedFile('');
              }}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-white"
            >
              <option value="">Select a job</option>
              {jobs.map(job => (
                <option key={job._id} value={job._id}>{job.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              File
            </label>
            <select
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              disabled={!selectedJob}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-white disabled:opacity-50"
            >
              <option value="">All files</option>
              {selectedJobData?.files?.map(file => (
                <option key={file} value={file}>{file}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-white"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      ) : !selectedJob ? (
        <div className="bg-gray-800 rounded-xl p-12 text-center">
          <span className="text-6xl">🔍</span>
          <h3 className="text-xl font-semibold text-white mt-4">Select a Job</h3>
          <p className="text-gray-400 mt-2">Choose a job to view its test history</p>
        </div>
      ) : executions.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-12 text-center">
          <span className="text-6xl">📭</span>
          <h3 className="text-xl font-semibold text-white mt-4">No History</h3>
          <p className="text-gray-400 mt-2">No test results found for this selection</p>
        </div>
      ) : (
        <div className="space-y-4">
          {executions.map((execution, index) => {
            const passed = execution.results.filter(r => r.state === 'passed').length;
            const failed = execution.results.filter(r => r.state === 'failed').length;
            const total = execution.results.length;

            return (
              <div key={index} className="bg-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">
                      Execution: {execution.executionId?.slice(0, 8) || 'Unknown'}
                    </div>
                    <div className="text-gray-400 text-sm">
                      {formatDate(execution.timestamp)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-green-400">{passed} passed</span>
                    <span className="text-red-400">{failed} failed</span>
                    <span className="text-gray-400">{total} total</span>
                  </div>
                </div>

                <div className="divide-y divide-gray-700">
                  {execution.results.map((result) => (
                    <div key={result._id} className="px-6 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStateColor(result.state)}`}>
                          {result.state.toUpperCase()}
                        </span>
                        <span className="text-white">{result.title}</span>
                        <span className="text-gray-500 text-sm">{result.fileName}</span>
                      </div>
                      <span className="text-gray-400 text-sm">{result.duration}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default History;
