import { useState, useEffect } from 'react';

const steps = [
  { id: 1, label: 'Sending request', icon: '📤' },
  { id: 2, label: 'Parsing errors', icon: '🔍' },
  { id: 3, label: 'Analyzing with AI', icon: '🤖' },
  { id: 4, label: 'Generating fix', icon: '🔧' },
  { id: 5, label: 'Checking test history', icon: '📊' },
  { id: 6, label: 'Determining action', icon: '⚡' },
  { id: 7, label: 'Complete', icon: '✅' },
];

const AnalysisWorkflow = ({ isActive, onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setCurrentStep(0);
      return;
    }

    // Simulate step progression
    const stepDurations = [500, 1000, 2000, 1500, 1000, 1500, 500];
    let totalDelay = 0;

    stepDurations.forEach((duration, index) => {
      totalDelay += duration;
      const timer = setTimeout(() => {
        setCurrentStep(index + 1);
        if (index === stepDurations.length - 1 && onComplete) {
          setTimeout(onComplete, 300);
        }
      }, totalDelay - duration);

      return () => clearTimeout(timer);
    });
  }, [isActive, onComplete]);

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl border border-gray-700">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🧪</div>
          <h3 className="text-xl font-bold text-white">Analyzing Failures</h3>
          <p className="text-gray-400 text-sm mt-1">Please wait while AI analyzes your test failures</p>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => {
            const isCompleted = currentStep > index;
            const isCurrent = currentStep === index;
            const isPending = currentStep < index;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                  isCompleted
                    ? 'bg-green-500/10 border border-green-500/30'
                    : isCurrent
                    ? 'bg-cyan-500/10 border border-cyan-500/50'
                    : 'bg-gray-700/30 border border-gray-700'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isCurrent
                      ? 'bg-cyan-500 text-white animate-pulse'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {isCompleted ? '✓' : step.id}
                </div>
                <div className="flex-1">
                  <span
                    className={`text-sm font-medium ${
                      isCompleted
                        ? 'text-green-400'
                        : isCurrent
                        ? 'text-cyan-400'
                        : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                <span className="text-lg">
                  {isCompleted ? '✅' : isCurrent ? (
                    <span className="animate-spin inline-block">⏳</span>
                  ) : step.icon}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-500 ease-out"
            style={{ width: `${(currentStep / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default AnalysisWorkflow;
