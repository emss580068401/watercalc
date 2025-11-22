import React, { useRef, useState, useEffect } from 'react';

interface StepperProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  step?: number;
  min?: number;
  subLabel?: string;
  colorClass?: string;
  statusColor?: string;
}

const Stepper: React.FC<StepperProps> = ({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  subLabel,
  colorClass = 'bg-white dark:bg-gray-800',
  statusColor,
}) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPointerDown = useRef(false);
  const activePointerId = useRef<number | null>(null);

  // Local state for manual input
  const [inputValue, setInputValue] = useState(value.toString());

  // sync from props
  useEffect(() => {
    if (parseFloat(inputValue) !== value) {
      setInputValue(value.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && (navigator as any).vibrate) {
      (navigator as any).vibrate(15);
    }
  };

  const applyStep = (amount: number) => {
    const next = Math.max(min, parseFloat((value + amount).toFixed(2)));
    if (next !== value) {
      onChange(next);
      setInputValue(next.toString());
      triggerHaptic();
    }
  };

  const clearTimers = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startContinuousChange = (
    e: React.PointerEvent<HTMLButtonElement>,
    amount: number,
  ) => {
    // Note: We rely on explicit touch listeners to preventDefault, 
    // but we also stop propagation here for Pointer events.
    e.stopPropagation();

    // 防止同一指頭觸發兩次 / 多指頭重複進來
    if (isPointerDown.current) return;

    isPointerDown.current = true;
    activePointerId.current = e.pointerId;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 某些瀏覽器可能不支援，不影響主流程
    }

    // 先做一次單步
    applyStep(amount);

    // 長按 500ms 之後啟動連續加減
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        applyStep(amount);
      }, 120);
    }, 500);
  };

  const stopContinuousChange = (
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();

    // 只處理目前這一個 pointer
    if (!isPointerDown.current || activePointerId.current !== e.pointerId) {
      return;
    }

    isPointerDown.current = false;
    activePointerId.current = null;
    clearTimers();

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // input 手動輸入
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    if (val === '') {
      onChange(min);
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num) && num >= min) {
      onChange(num);
    }
  };

  const handleBlur = () => {
    setInputValue(value.toString());
  };

  return (
    <div
      className={`p-4 rounded-2xl shadow-md border-2 border-gray-300 dark:border-gray-600 mb-4 select-none ${colorClass}`}
    >
      {/* Header Label Row */}
      <div className="flex justify-between items-baseline mb-3 px-1">
        <div className="flex items-center gap-2">
          {statusColor && (
            <span
              className={`w-3 h-3 rounded-full ${statusColor} ring-1 ring-offset-1 ring-gray-300 dark:ring-gray-600`}
            ></span>
          )}
          <label className="text-xl font-black text-black dark:text-white tracking-tight break-words">
            {label}
          </label>
        </div>
        {subLabel && (
          <span className="text-base text-gray-900 dark:text-gray-200 font-bold whitespace-nowrap">
            {subLabel}
          </span>
        )}
      </div>

      {/* Control Row: [Input] [Minus] [Plus] */}
      <div className="flex items-stretch h-20 gap-3">
        
        {/* Value Display (Left) */}
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 border-2 border-gray-400 dark:border-gray-500 rounded-xl relative overflow-hidden">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleBlur}
            onFocus={(e) => e.target.select()}
            className="w-full h-full text-center text-4xl font-black bg-transparent text-blue-800 dark:text-blue-300 outline-none placeholder-gray-300 appearance-none m-0 p-0"
          />
        </div>

        {/* Minus Button (Middle) */}
        <button
          className="w-24 flex-none rounded-xl bg-gray-200 dark:bg-gray-700 text-black dark:text-white active:bg-red-600 active:text-white active:scale-95 transition-all flex items-center justify-center shadow-sm border-2 border-gray-300 dark:border-gray-500 touch-none"
          type="button"
          aria-label="Decrease"
          onPointerDown={(e) => startContinuousChange(e, -step)}
          onPointerUp={stopContinuousChange}
          onPointerLeave={stopContinuousChange}
          onPointerCancel={stopContinuousChange}
          onTouchStart={(e) => e.preventDefault()}
          onTouchMove={(e) => e.preventDefault()}
          onTouchEnd={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={4}
            stroke="currentColor"
            className="w-8 h-8 pointer-events-none"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
          </svg>
        </button>

        {/* Plus Button (Right) */}
        <button
          className="w-24 flex-none rounded-xl bg-blue-600 text-white active:bg-blue-700 active:scale-95 transition-all flex items-center justify-center shadow-md shadow-blue-600/30 border-2 border-blue-700 touch-none"
          type="button"
          aria-label="Increase"
          onPointerDown={(e) => startContinuousChange(e, step)}
          onPointerUp={stopContinuousChange}
          onPointerLeave={stopContinuousChange}
          onPointerCancel={stopContinuousChange}
          onTouchStart={(e) => e.preventDefault()}
          onTouchMove={(e) => e.preventDefault()}
          onTouchEnd={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={4}
            stroke="currentColor"
            className="w-8 h-8 pointer-events-none"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Stepper;