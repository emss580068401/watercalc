
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ResponsiveContainer, Cell, PieChart, Pie, Legend, Tooltip } from 'recharts';
import Stepper from './components/Stepper';
import InfoModal from './components/InfoModal';
import HydraulicSlider from './components/HydraulicSlider';
import { calculateAll } from './utils/calculations';
import { WaterState, WakeLockSentinel } from './types';
import { INITIAL_STATE, MAP_CENTER_LAT, MAP_CENTER_LNG, MAP_MID } from './constants';

const STORAGE_KEY = 'emeiWaterCalcV3';

const TABS = [
  { id: 'demand', label: '用水需求', icon: '🔥' },
  { id: 'tanks', label: '水箱容量', icon: '💧' },
  { id: 'sources', label: '現場水源', icon: '🚰' },
  { id: 'relay', label: '循環條件', icon: '🔄' },
  { id: 'result', label: '計算結果', icon: '📊' },
  { id: 'map', label: '水源地圖', icon: '🗺️' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('demand');
  const [state, setState] = useState<WaterState>(INITIAL_STATE);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [selectedSlice, setSelectedSlice] = useState<string | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Persistence
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setState(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load state", e);
      }
    }

    // Check system dark mode removed to default to light
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Screen Wake Lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && navigator.wakeLock) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.error(err);
        }
      }
    };
    requestWakeLock();
    
    // Re-acquire lock if visibility changes (e.g., switching apps)
    const handleVisibilityChange = () => {
       if (document.visibilityState === 'visible') {
         requestWakeLock();
       }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (wakeLock) wakeLock.release();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const toggleDark = () => {
    if (navigator.vibrate) navigator.vibrate(15);
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  const update = (key: keyof WaterState, val: number) => {
    setState(prev => ({ ...prev, [key]: val }));
  };

  const confirmReset = () => {
    if (navigator.vibrate) navigator.vibrate([15, 50, 15]);
    setState(INITIAL_STATE);
    setIsResetModalOpen(false);
  };

  const handleTabChange = (id: string) => {
     if (navigator.vibrate) navigator.vibrate(15);
     setActiveTab(id);
  };

  // Real-time calculation
  const res = useMemo(() => calculateAll(state), [state]);
  
  // Duration formatting helper (prevents 60s edge case)
  const durationDisplay = useMemo(() => {
    if (!isFinite(res.durationMin)) return { m: '-', s: '-' };
    const totalSeconds = Math.round(res.durationMin * 60);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return { m, s };
  }, [res.durationMin]);

  // Map helpers
  const openMap = (type: 'google' | 'mymaps') => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const url = type === 'google' 
          ? `https://www.google.com/maps/@${lat},${lng},15z`
          : `https://www.google.com/maps/d/viewer?mid=${MAP_MID}&ll=${lat}%2C${lng}&z=15`;
        window.open(url, '_blank');
      },
      () => {
         const url = type === 'google' 
          ? `https://www.google.com/maps/@${MAP_CENTER_LAT},${MAP_CENTER_LNG},14z`
          : `https://www.google.com/maps/d/viewer?mid=${MAP_MID}&ll=${MAP_CENTER_LAT}%2C${MAP_CENTER_LNG}&z=14`;
        window.open(url, '_blank');
      }
    );
  };

  // Copy Report Function
  const copyReport = () => {
    if (navigator.vibrate) navigator.vibrate(15);
    const timeStr = res.net <= 0 
      ? '充足 ∞' 
      : durationDisplay.m !== '-' 
        ? `${durationDisplay.m}分${durationDisplay.s}秒` 
        : '-';

    const text = `[水源計算機報表]
總需求: ${Math.round(res.demand)} gpm
總供給: ${Math.round(res.qFrontline + res.circEff)} gpm
淨需求: ${Math.round(res.net)} gpm (${res.net > 0 ? '不足' : '充足'})
水箱撐時: ${timeStr}
供需覆蓋率: ${Math.round(res.coverage)}%`;
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert('報表已複製！可直接貼上。');
      }).catch(() => {
        alert('複製失敗，請手動截圖。');
      });
    } else {
      alert('您的瀏覽器不支援自動複製。');
    }
  };

  // Ensure chart data values are integers
  const pieDataVisual = [
      { name: '現場', value: Math.round(res.qFrontline), fill: '#3b82f6' },
      { name: '循環', value: Math.round(res.circEff), fill: '#22c55e' },
      { name: '淨需求', value: Math.round(res.net), fill: '#ef4444' }
  ].filter(d => d.value > 0);

  const idleTime = Math.max(0, res.overallInterval - res.tFillSource);

  // Color for coverage bar
  const getCoverageColor = (p: number) => {
    if (p >= 100) return 'bg-green-500';
    if (p >= 70) return 'bg-orange-500';
    return 'bg-red-600';
  };

  // Calculate Status Color for Relay Trucks
  const getRelayStatusColor = (compression: number, count: number) => {
    if (count <= 0) return "bg-gray-300 dark:bg-gray-600"; // Inactive
    if (compression >= 0.95) return "bg-green-500"; // Efficient
    if (compression >= 0.7) return "bg-yellow-500"; // Warning
    return "bg-red-500"; // Bottleneck/Inefficient
  };

  const renderTruckDetail = (count: number, stats: {tFill: number, tDrive: number, tc: number}, label: string) => {
    if (count <= 0) return null;
    const efficiencyPercent = Math.round(res.compression * 100);
    const effColor = getRelayStatusColor(res.compression, 1);
    
    return (
      <div className="mx-2 mb-4 -mt-2 bg-gray-100 dark:bg-slate-800/50 rounded-b-xl border-x-2 border-b-2 border-gray-300 dark:border-slate-600 overflow-hidden">
        <div className="p-3 grid grid-cols-2 gap-x-2 gap-y-1 text-sm font-bold text-gray-700 dark:text-gray-300">
          <div>加滿: <span className="text-black dark:text-white">{isFinite(stats.tFill) ? stats.tFill.toFixed(1) : '-'}</span> 分</div>
          <div>行駛: <span className="text-black dark:text-white">{stats.tDrive.toFixed(1)}</span> 分</div>
          <div>工作: <span className="text-black dark:text-white">{state.modWork.toFixed(1)}</span> 分</div>
          <div className="col-span-2 border-t border-gray-300 dark:border-slate-600 mt-1 pt-1 text-center text-blue-800 dark:text-blue-300">
            總圈: <span className="font-black text-base">{isFinite(stats.tc) ? stats.tc.toFixed(1) : '-'}</span> 分
          </div>
        </div>
        
        {/* Efficiency Bar Visual */}
        <div className="px-3 pb-3">
           <div className="flex justify-between text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
              <span>供水效能 (壓縮比)</span>
              <span>{efficiencyPercent}%</span>
           </div>
           <div className="w-full h-2 bg-gray-300 dark:bg-gray-600 rounded-full overflow-hidden">
             <div 
               className={`h-full transition-all duration-500 ${effColor}`} 
               style={{ width: `${efficiencyPercent}%` }}
             ></div>
           </div>
        </div>
      </div>
    );
  };

  // Render Detail View for Pie Chart
  const renderSliceDetail = () => {
    if (!selectedSlice) return null;
    
    const frontFactor = 1 - state.frontReducePct / 100;

    // Dynamic styling based on selection
    let containerClasses = "bg-gray-100 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600";
    let headerColor = "text-black dark:text-white";

    if (selectedSlice === '現場') {
      containerClasses = "bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400 ring-4 ring-blue-500/10";
      headerColor = "text-blue-800 dark:text-blue-200";
    } else if (selectedSlice === '循環') {
      containerClasses = "bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-400 ring-4 ring-green-500/10";
      headerColor = "text-green-800 dark:text-green-200";
    } else if (selectedSlice === '淨需求') {
      containerClasses = "bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400 ring-4 ring-red-500/10";
      headerColor = "text-red-800 dark:text-red-200";
    }

    return (
      <div className={`mt-4 p-4 rounded-xl border-2 animate-fade-in text-left transition-all ${containerClasses}`}>
        <div className="flex justify-between items-center mb-3">
          <h4 className={`font-black text-xl ${headerColor}`}>{selectedSlice}細節</h4>
          <button 
            onClick={(e) => { e.stopPropagation(); setSelectedSlice(null); }}
            className="w-10 h-10 flex items-center justify-center bg-white/50 dark:bg-black/20 rounded-full text-gray-900 dark:text-gray-100 active:scale-95 font-bold text-xl hover:bg-white/80 dark:hover:bg-black/40 transition-colors"
          >
            ✕
          </button>
        </div>

        {selectedSlice === '現場' && (
           <div className="space-y-3">
             {[
               { l: '消防栓', v: state.hydrant * state.hydrantFlow },
               { l: '建築設備', v: state.bHydrant * state.bHydrantFlow },
               { l: '小型車抽水', v: state.smallPump * state.smallPumpFlow },
               { l: '一般車抽水', v: state.normalPump * state.normalFlow },
               { l: '水庫車抽水', v: state.reservoirPump * state.reservoirPumpFlow },
               { l: '移動幫浦', v: state.portablePump * state.portablePumpFlow },
             ].filter(i => i.v > 0).length === 0 ? (
               <div className="text-gray-600 dark:text-gray-300 font-black text-lg">未設定現場水源</div>
             ) : (
               [
                 { l: '消防栓', v: state.hydrant * state.hydrantFlow },
                 { l: '建築設備', v: state.bHydrant * state.bHydrantFlow },
                 { l: '小型車抽水', v: state.smallPump * state.smallPumpFlow },
                 { l: '一般車抽水', v: state.normalPump * state.normalFlow },
                 { l: '水庫車抽水', v: state.reservoirPump * state.reservoirPumpFlow },
                 { l: '移動幫浦', v: state.portablePump * state.portablePumpFlow },
               ].filter(i => i.v > 0).map((item, idx) => (
                 <div key={idx} className="flex justify-between text-lg font-black text-black dark:text-white border-b border-gray-300 dark:border-gray-600 last:border-0 pb-2 last:pb-0">
                   <span>{item.l}</span>
                   <span>{Math.round(item.v * frontFactor)} <span className="text-base font-black text-gray-600 dark:text-gray-400">gpm</span></span>
                 </div>
               ))
             )}
             <div className="pt-2 text-sm text-right text-gray-600 dark:text-gray-400 font-bold">
               *已套用前方折減 {state.frontReducePct}%
             </div>
           </div>
        )}

        {selectedSlice === '循環' && (
            <div className="space-y-3">
              {[
                { l: '2噸車', n: state.modN2, q: res.relayStats.q2 },
                { l: '4噸車', n: state.modN4, q: res.relayStats.q4 },
                { l: '10噸車', n: state.modN10, q: res.relayStats.q10 },
                { l: '12噸車', n: state.modN12, q: res.relayStats.q12 },
              ].filter(i => i.n > 0).length === 0 ? (
                <div className="text-gray-600 dark:text-gray-300 font-black text-lg">未投入循環車輛</div>
              ) : (
                 [
                  { l: '2噸車', n: state.modN2, q: res.relayStats.q2 },
                  { l: '4噸車', n: state.modN4, q: res.relayStats.q4 },
                  { l: '10噸車', n: state.modN10, q: res.relayStats.q10 },
                  { l: '12噸車', n: state.modN12, q: res.relayStats.q12 },
                ].filter(i => i.n > 0).map((item, idx) => (
                  <div key={idx} className="flex justify-between text-lg font-black text-black dark:text-white border-b border-gray-300 dark:border-gray-600 last:border-0 pb-2 last:pb-0">
                    <span>{item.l} <span className="text-base font-black text-gray-600 dark:text-gray-400">x{item.n}</span></span>
                    <span>{Math.round(item.n * item.q)} <span className="text-base font-black text-gray-600 dark:text-gray-400">gpm</span></span>
                  </div>
                ))
              )}
              <div className="pt-2 text-sm text-right text-gray-600 dark:text-gray-400 font-bold">
                 *受水源與後方折減限制
              </div>
            </div>
        )}

        {selectedSlice === '淨需求' && (
            <div className="space-y-3">
               <div className="flex justify-between text-lg font-black text-black dark:text-white">
                  <span>總需求</span>
                  <span>{Math.round(res.demand)} <span className="text-base font-black text-gray-600 dark:text-gray-400">gpm</span></span>
               </div>
               <div className="flex justify-between text-lg font-black text-blue-700 dark:text-blue-300">
                  <span>總供給 (現場+循環)</span>
                  <span>-{Math.round(res.qFrontline + res.circEff)} <span className="text-base font-black text-gray-600 dark:text-gray-400">gpm</span></span>
               </div>
               <div className="border-t-2 border-gray-300 dark:border-gray-600 my-1"></div>
               <div className="flex justify-between text-xl font-black text-red-600 dark:text-red-400">
                  <span>淨需求</span>
                  <span>{Math.round(res.net)} <span className="text-base font-black text-red-500 dark:text-red-300">gpm</span></span>
               </div>
               <div className="pt-1 text-sm text-gray-600 dark:text-gray-400 font-bold">
                 需消耗水箱水源，請參考「水箱撐時」。
               </div>
            </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-28 transition-colors duration-200 font-sans">
      
      {/* Top Bar */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 shadow-md h-16 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-800">
        <button 
          onClick={() => { if (navigator.vibrate) navigator.vibrate(15); setIsInfoOpen(true); }} 
          className="h-10 w-12 flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 rounded-xl active:scale-95 transition-transform border-2 border-blue-200 dark:border-blue-800"
        >
          <span className="text-2xl leading-none font-bold">☰</span>
        </button>
        
        <h1 className="text-xl font-black text-black dark:text-white tracking-tight">水源計算機</h1>
        
        <button 
          onClick={toggleDark} 
          className="h-10 w-10 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-xl text-xl active:scale-95 transition-transform border-2 border-gray-200 dark:border-gray-700"
        >
          {isDark ? '☀️' : '🌙'}
        </button>
      </header>

      <InfoModal isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} />

      {/* Custom Large Reset Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center isolate">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsResetModalOpen(false)}></div>
          <div className="relative bg-white dark:bg-gray-800 p-6 rounded-3xl w-[90%] max-w-sm shadow-2xl border-2 border-gray-300 dark:border-gray-600 animate-fade-in">
             <h3 className="text-2xl font-black text-center mb-4 text-black dark:text-white">確定重置所有數據？</h3>
             <p className="text-gray-600 dark:text-gray-300 text-center mb-8 font-bold text-lg">所有輸入將恢復為預設值。</p>
             <div className="grid grid-cols-2 gap-4">
               <button 
                 onClick={() => { if(navigator.vibrate) navigator.vibrate(15); setIsResetModalOpen(false); }}
                 className="py-4 rounded-2xl bg-gray-200 dark:bg-gray-700 text-black dark:text-white font-black text-xl border-2 border-gray-300 dark:border-gray-600 active:scale-95 transition-transform"
               >
                 取消
               </button>
               <button 
                 onClick={confirmReset}
                 className="py-4 rounded-2xl bg-red-600 text-white font-black text-xl border-2 border-red-700 shadow-lg active:scale-95 transition-transform"
               >
                 確認重置
               </button>
             </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="pt-20 px-3 max-w-md mx-auto w-full space-y-6">
        
        {/* Large Scrollable Tabs */}
        <div className="sticky top-16 z-30 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm py-3 -mx-3 px-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex overflow-x-auto gap-3 pb-2 px-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex-shrink-0 px-4 py-3 rounded-2xl font-black text-lg flex items-center gap-2 transition-all border-2 ${
                  activeTab === tab.id 
                  ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/30 scale-100' 
                  : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
            <div className="w-8 flex-shrink-0"></div>
          </div>
        </div>

        {/* Page 1: Demand */}
        {activeTab === 'demand' && (
          <div className="animate-fade-in space-y-5">
            <Stepper label="1.5吋 瞄子 (支)" subLabel="100 gpm" value={state.n15} onChange={(v) => update('n15', v)} />
            <Stepper label="2.5吋 瞄子 (支)" subLabel="200 gpm" value={state.n25} onChange={(v) => update('n25', v)} />
            
            <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border-2 border-gray-300 dark:border-gray-600">
               <label className="block text-xl font-black mb-2 text-black dark:text-white">機器人流量 (gpm)</label>
               <div className="flex h-16">
                  <input 
                    type="number" 
                    inputMode="decimal"
                    className="w-full h-full text-center text-3xl font-black bg-gray-100 dark:bg-gray-700 rounded-xl text-blue-800 dark:text-blue-300 outline-none focus:ring-4 ring-blue-500/30 transition-all border border-gray-300 dark:border-gray-600" 
                    value={state.robotFlow} 
                    onChange={e => update('robotFlow', parseFloat(e.target.value)||0)} 
                    onFocus={(e) => e.target.select()}
                  />
               </div>
            </div>
            
            <Stepper label="機器人數量 (台)" value={state.robotCount} onChange={(v) => update('robotCount', v)} />
            
            <button 
              onClick={() => { if(navigator.vibrate) navigator.vibrate(15); setIsResetModalOpen(true); }} 
              className="w-full py-5 mt-8 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-2xl font-black text-xl active:bg-gray-300 dark:active:bg-gray-600 transition-colors border-2 border-gray-300 dark:border-gray-500 shadow-sm"
            >
              ↺ 恢復預設值
            </button>
          </div>
        )}

        {/* Page 2: Tanks */}
        {activeTab === 'tanks' && (
          <div className="animate-fade-in space-y-4">
             <Stepper label="2 噸水箱 (輛)" subLabel="2000L" value={state.smallTruck} onChange={(v) => update('smallTruck', v)} />
             <Stepper label="4 噸水箱 (輛)" subLabel="4000L" value={state.normalTruck} onChange={(v) => update('normalTruck', v)} />
             <Stepper label="10 噸水庫 (輛)" subLabel="10000L" value={state.reservoirTruck} onChange={(v) => update('reservoirTruck', v)} />
             <Stepper label="12 噸水庫 (輛)" subLabel="12000L" value={state.truck12} onChange={(v) => update('truck12', v)} />
             
             <div className="sticky bottom-4 z-20 mt-6 p-5 bg-white dark:bg-gray-800 rounded-2xl text-center border-4 border-blue-200 dark:border-blue-800 shadow-xl">
                <p className="text-gray-900 dark:text-gray-200 text-sm font-black uppercase tracking-widest mb-1">目前車隊總水量</p>
                <div className="text-5xl font-black text-blue-800 dark:text-blue-300 tracking-tighter">
                  {res.totalTankL.toLocaleString()} <span className="text-xl font-bold text-gray-600 dark:text-gray-400">L</span>
                </div>
             </div>
          </div>
        )}

        {/* Page 3: Sources */}
        {activeTab === 'sources' && (
          <div className="animate-fade-in space-y-8">
            
            {/* Fixed Sources */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-3xl border-2 border-gray-300 dark:border-gray-600 shadow-sm">
               <h3 className="font-black text-2xl mb-4 text-black dark:text-white flex items-center gap-2">
                 <span className="text-blue-600">▌</span> 固定水源
               </h3>
               <div className="space-y-6">
                 {/* Hydrant */}
                 <div className="flex flex-col gap-2">
                   <Stepper label="消防栓 (座)" value={state.hydrant} onChange={(v) => update('hydrant', v)} />
                   <div className="flex items-center gap-3 pl-2">
                     <span className="text-gray-900 dark:text-gray-200 font-bold text-lg w-16">單座流量</span>
                     <input type="number" inputMode="decimal" className="flex-1 h-14 rounded-xl text-center bg-gray-100 dark:bg-gray-700 text-black dark:text-white font-black text-xl border-2 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500" value={state.hydrantFlow} onChange={e => update('hydrantFlow', parseFloat(e.target.value))} onFocus={(e) => e.target.select()} />
                     <span className="text-gray-800 dark:text-gray-300 font-bold w-8">gpm</span>
                   </div>
                 </div>

                 <div className="w-full h-px bg-gray-300 dark:bg-gray-700"></div>

                 {/* Building */}
                 <div className="flex flex-col gap-2">
                   <Stepper label="建築設備 (座)" value={state.bHydrant} onChange={(v) => update('bHydrant', v)} />
                   <div className="flex items-center gap-3 pl-2">
                     <span className="text-gray-900 dark:text-gray-200 font-bold text-lg w-16">單座流量</span>
                     <input type="number" inputMode="decimal" className="flex-1 h-14 rounded-xl text-center bg-gray-100 dark:bg-gray-700 text-black dark:text-white font-black text-xl border-2 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500" value={state.bHydrantFlow} onChange={e => update('bHydrantFlow', parseFloat(e.target.value))} onFocus={(e) => e.target.select()} />
                     <span className="text-gray-800 dark:text-gray-300 font-bold w-8">gpm</span>
                   </div>
                 </div>
               </div>
            </div>

            {/* Vehicle Pumps */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-3xl border-2 border-gray-300 dark:border-gray-600 shadow-sm">
               <h3 className="font-black text-2xl mb-4 text-black dark:text-white flex items-center gap-2">
                 <span className="text-green-600">▌</span> 車輛抽水
               </h3>
               
               <div className="space-y-6">
                  {/* Small Pump */}
                  <div className="flex flex-col gap-2">
                    <Stepper label="小型車 (台)" value={state.smallPump} onChange={v => update('smallPump', v)} />
                    <div className="flex items-center gap-3 pl-2">
                       <span className="text-gray-900 dark:text-gray-200 font-bold text-lg w-16">單車流量</span>
                       <input type="number" inputMode="decimal" className="flex-1 h-14 rounded-xl text-center bg-gray-100 dark:bg-gray-700 text-black dark:text-white font-black text-xl border-2 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500" value={state.smallPumpFlow} onChange={e => update('smallPumpFlow', parseFloat(e.target.value))} onFocus={(e) => e.target.select()} />
                       <span className="text-gray-800 dark:text-gray-300 font-bold w-8">gpm</span>
                    </div>
                  </div>

                  <div className="w-full h-px bg-gray-300 dark:bg-gray-700"></div>

                  {/* Normal Pump */}
                  <div className="flex flex-col gap-2">
                    <Stepper label="一般車 (台)" value={state.normalPump} onChange={v => update('normalPump', v)} />
                    <div className="flex items-center gap-3 pl-2">
                       <span className="text-gray-900 dark:text-gray-200 font-bold text-lg w-16">單車流量</span>
                       <input type="number" inputMode="decimal" className="flex-1 h-14 rounded-xl text-center bg-gray-100 dark:bg-gray-700 text-black dark:text-white font-black text-xl border-2 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500" value={state.normalFlow} onChange={e => update('normalFlow', parseFloat(e.target.value))} onFocus={(e) => e.target.select()} />
                       <span className="text-gray-800 dark:text-gray-300 font-bold w-8">gpm</span>
                    </div>
                  </div>

                  <div className="w-full h-px bg-gray-300 dark:bg-gray-700"></div>

                  {/* Reservoir Pump */}
                  <div className="flex flex-col gap-2">
                    <Stepper label="水庫車 (台)" value={state.reservoirPump} onChange={v => update('reservoirPump', v)} />
                    <div className="flex items-center gap-3 pl-2">
                       <span className="text-gray-900 dark:text-gray-200 font-bold text-lg w-16">單車流量</span>
                       <input type="number" inputMode="decimal" className="flex-1 h-14 rounded-xl text-center bg-gray-100 dark:bg-gray-700 text-black dark:text-white font-black text-xl border-2 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500" value={state.reservoirPumpFlow} onChange={e => update('reservoirPumpFlow', parseFloat(e.target.value))} onFocus={(e) => e.target.select()} />
                       <span className="text-gray-800 dark:text-gray-300 font-bold w-8">gpm</span>
                    </div>
                  </div>

                  <div className="w-full h-px bg-gray-300 dark:bg-gray-700"></div>

                  {/* Portable Pump */}
                  <div className="flex flex-col gap-2">
                    <Stepper label="移動幫浦 (台)" value={state.portablePump} onChange={v => update('portablePump', v)} />
                    <div className="flex items-center gap-3 pl-2">
                       <span className="text-gray-900 dark:text-gray-200 font-bold text-lg w-16">單機流量</span>
                       <input type="number" inputMode="decimal" className="flex-1 h-14 rounded-xl text-center bg-gray-100 dark:bg-gray-700 text-black dark:text-white font-black text-xl border-2 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500" value={state.portablePumpFlow} onChange={e => update('portablePumpFlow', parseFloat(e.target.value))} onFocus={(e) => e.target.select()} />
                       <span className="text-gray-800 dark:text-gray-300 font-bold w-8">gpm</span>
                    </div>
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* Page 4: Relay Logic */}
        {activeTab === 'relay' && (
          <div className="animate-fade-in space-y-5">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-800">
              <h3 className="text-center font-black text-blue-900 dark:text-blue-100 mb-4 text-xl">基礎設定</h3>
              <Stepper label="取水距離 (km)" step={0.05} value={state.modDist} onChange={v => update('modDist', v)} colorClass="bg-white dark:bg-gray-800" />
              <Stepper label="供水線數 (條)" value={state.modLines} onChange={v => update('modLines', v)} colorClass="bg-white dark:bg-gray-800" />
              <Stepper label="出水壓力 (kg/cm²)" step={0.5} value={state.modP} onChange={v => update('modP', v)} colorClass="bg-white dark:bg-gray-800" />
            </div>
            
            <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border-2 border-gray-300 dark:border-gray-600">
               <label className="block text-xl font-black mb-3 text-black dark:text-white">佔據水源車輛</label>
               <div className="relative">
                 <select 
                  className="w-full h-16 bg-gray-100 dark:bg-gray-700 text-black dark:text-white rounded-xl text-xl font-black px-4 appearance-none outline-none focus:ring-4 ring-blue-500/20 border-2 border-gray-300 dark:border-gray-600"
                  value={state.srcS}
                  onChange={(e) => update('srcS', parseFloat(e.target.value))}
                 >
                   <option value="2">2 噸水箱車</option>
                   <option value="4">4 噸水箱車</option>
                   <option value="10">10 噸水庫車</option>
                   <option value="12">12 噸水庫車</option>
                 </select>
                 <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-800 dark:text-gray-300 text-xl">▼</div>
               </div>
            </div>
            
             <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border-2 border-gray-300 dark:border-gray-600">
               <label className="block text-xl font-black mb-3 text-black dark:text-white">水源名目流量 (gpm)</label>
               <input type="number" inputMode="decimal" className="w-full h-16 text-center text-3xl font-black bg-gray-100 dark:bg-gray-700 text-black dark:text-white rounded-xl outline-none focus:ring-4 ring-blue-500/20 border-2 border-gray-300 dark:border-gray-600" value={state.srcQh} onChange={e => update('srcQh', parseFloat(e.target.value)||0)} onFocus={(e) => e.target.select()} />
            </div>

            <Stepper label="拆裝時間 (分)" step={0.5} value={state.modWork} onChange={v => update('modWork', v)} />
            
            <div className="grid grid-cols-2 gap-3">
               {[{l:'2噸',k:'v2'}, {l:'4噸',k:'v4'}, {l:'10噸',k:'v10'}, {l:'12噸',k:'v12'}].map((item) => (
                 <div key={item.k} className="p-4 bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-300 dark:border-gray-600">
                   <label className="text-base font-black text-black dark:text-white block mb-2">{item.l}車速</label>
                   <div className="flex items-baseline justify-center gap-1">
                      <input 
                        type="number"
                        inputMode="decimal"
                        className="w-full text-center text-4xl font-black bg-transparent text-black dark:text-white outline-none p-0" 
                        value={state[item.k as keyof WaterState]} 
                        onChange={e=>update(item.k as keyof WaterState, parseFloat(e.target.value))} 
                        onFocus={(e) => e.target.select()}
                      />
                      <span className="text-base font-bold text-gray-600 dark:text-gray-400">km/h</span>
                   </div>
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* Page 5: Results */}
        {activeTab === 'result' && (
          <div className="animate-fade-in space-y-6 pb-10">

             {/* Chart & Coverage Section */}
             <div className="bg-white dark:bg-gray-800 p-5 rounded-3xl shadow-sm border-2 border-gray-300 dark:border-gray-600 relative">
               <button 
                 onClick={copyReport}
                 className="absolute top-4 right-4 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1.5 rounded-lg font-bold active:scale-95 transition-transform shadow-sm border border-gray-300 dark:border-gray-600 flex items-center gap-1"
               >
                 <span>📄</span> 複製報表
               </button>
               <h3 className="text-center font-black text-black dark:text-white text-2xl mb-2">供需組成分析</h3>
               
               <div className="h-64 w-full">
                 <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieDataVisual}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={5}
                        dataKey="value"
                        onClick={(data) => { if(navigator.vibrate) navigator.vibrate(15); setSelectedSlice(prev => prev === data.name ? null : data.name); }}
                      >
                        {pieDataVisual.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} strokeWidth={0} cursor="pointer" />
                        ))}
                      </Pie>
                      <Legend 
                        verticalAlign="bottom" 
                        height={36} 
                        iconType="circle" 
                        formatter={(val) => <span className="text-lg font-black text-gray-900 dark:text-gray-200 ml-1 mr-3">{val}</span>} 
                      />
                      <Tooltip 
                        contentStyle={{
                           backgroundColor: 'rgba(255, 255, 255, 0.95)',
                           borderRadius: '12px',
                           border: 'none',
                           boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                           padding: '10px 14px'
                        }}
                        itemStyle={{ color: '#000', fontWeight: 900, fontSize: '1.1rem' }}
                        formatter={(val: number) => [`${val} gpm`]}
                      />
                    </PieChart>
                 </ResponsiveContainer>
               </div>

               {/* Coverage Progress Bar */}
               <div className="mt-4 px-2">
                 <div className="flex justify-between font-black text-lg mb-1">
                   <span className="text-gray-900 dark:text-white">供需覆蓋率</span>
                   <span className={`${res.coverage >= 100 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{Math.round(res.coverage)}%</span>
                 </div>
                 <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-5 border border-gray-300 dark:border-gray-600 overflow-hidden">
                   <div
                     className={`h-5 rounded-full transition-all duration-500 ${getCoverageColor(res.coverage)}`}
                     style={{ width: `${Math.min(100, res.coverage)}%` }}
                   ></div>
                 </div>
               </div>
               
               {/* Pie Chart Click Details */}
               {renderSliceDetail()}
            </div>
            
            {/* Key Metrics Cards Grid */}
            <div className="grid grid-cols-2 gap-3">
              
              {/* 1. Total Demand - Red Theme */}
              <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-2xl border-2 border-red-200 dark:border-red-800 text-center shadow-sm flex flex-col justify-center">
                <div className="text-red-900 dark:text-red-100 font-bold text-base mb-1">總需求</div>
                <div className="text-3xl font-black text-red-700 dark:text-red-300">
                  {Math.round(res.demand)} <span className="text-base text-red-600/70 dark:text-red-300/70 font-bold">gpm</span>
                </div>
              </div>

              {/* 2. Total Supply - Blue Theme */}
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-800 text-center shadow-sm flex flex-col justify-center">
                <div className="text-blue-900 dark:text-blue-100 font-bold text-base mb-1">總供給</div>
                <div className="text-3xl font-black text-blue-700 dark:text-blue-300">
                  {Math.round(res.qFrontline + res.circEff)} <span className="text-base text-blue-600/70 dark:text-blue-300/70 font-bold">gpm</span>
                </div>
              </div>

              {/* 3. Net Demand Card with Pulse Animation */}
              <div className={`col-span-2 p-5 rounded-3xl border-4 text-center shadow-lg transition-all ${
                res.net > 0 
                  ? 'bg-red-600 border-red-800 text-white animate-pulse' 
                  : 'bg-green-600 border-green-800 text-white'
              }`}>
                 <div className="text-lg font-bold opacity-90 mb-1">淨需求 (短缺)</div>
                 <div className="text-6xl font-black tracking-tighter leading-none">
                   {Math.round(res.net)}
                   <span className="text-2xl ml-2 opacity-90 font-bold">gpm</span>
                 </div>
                 <div className="mt-2 text-xl font-bold bg-black/20 rounded-lg py-1 px-4 inline-block">
                    {res.net <= 0 ? '💧 水源充足' : '⚠️ 水源不足'}
                 </div>
              </div>

              {/* 4. Duration (Horizontal Layout) */}
              <div className="col-span-2 bg-white dark:bg-gray-800 p-5 rounded-2xl border-2 border-gray-300 dark:border-gray-600 text-center shadow-sm flex flex-col justify-center">
                <div className="text-gray-900 dark:text-gray-200 font-bold text-lg mb-1">水箱撐時</div>
                <div className="text-black dark:text-white">
                  {res.net <= 0 
                    ? <span className="text-4xl font-black">∞ <span className="text-lg">充足</span></span>
                    : durationDisplay.m !== '-' 
                      ? <div className="flex items-baseline justify-center gap-2">
                          <span className="text-4xl font-black">{durationDisplay.m} <span className="text-xl text-gray-600 dark:text-gray-400">分</span></span>
                          <span className="text-4xl font-black">{durationDisplay.s} <span className="text-xl text-gray-600 dark:text-gray-400">秒</span></span>
                        </div>
                      : <span className="text-4xl font-black">-</span>}
                </div>
              </div>
            </div>

            {/* Sliders Section */}
            <div className="space-y-2">
               <HydraulicSlider 
                 label="前方折減" 
                 subText="水箱+現場水源 → 瞄子"
                 value={state.frontReducePct} 
                 onChange={v => update('frontReducePct', v)} 
               />
               <HydraulicSlider 
                 label="後方折減" 
                 subText="水源 → 循環車隊"
                 value={state.rearReducePct} 
                 onChange={v => update('rearReducePct', v)} 
               />
            </div>

            {/* Relay Truck Manager */}
            <div className="bg-blue-50 dark:bg-slate-900 p-5 rounded-3xl border-4 border-blue-200 dark:border-slate-700">
               <h3 className="font-black text-3xl mb-6 text-center text-blue-900 dark:text-blue-100">循環車隊配置</h3>
               
               <div>
                 <Stepper label="2 噸車 (輛)" value={state.modN2} onChange={v => update('modN2', v)} 
                   subLabel={state.modN2 > 0 ? `${Math.round(res.relayStats.q2)} gpm/車 (實際)` : `${Math.round(res.relayStats.baseQ2)} gpm/車 (理想)`} 
                   colorClass="bg-white dark:bg-slate-800"
                   statusColor={getRelayStatusColor(res.compression, state.modN2)}
                 />
                 {renderTruckDetail(state.modN2, { tFill: res.relayStats.tFill2, tDrive: res.relayStats.td2, tc: res.relayStats.tc2 }, '2噸')}
               </div>

               <div>
                 <Stepper label="4 噸車 (輛)" value={state.modN4} onChange={v => update('modN4', v)} 
                   subLabel={state.modN4 > 0 ? `${Math.round(res.relayStats.q4)} gpm/車 (實際)` : `${Math.round(res.relayStats.baseQ4)} gpm/車 (理想)`} 
                   colorClass="bg-white dark:bg-slate-800"
                   statusColor={getRelayStatusColor(res.compression, state.modN4)}
                 />
                 {renderTruckDetail(state.modN4, { tFill: res.relayStats.tFill4, tDrive: res.relayStats.td4, tc: res.relayStats.tc4 }, '4噸')}
               </div>

               <div>
                 <Stepper label="10 噸車 (輛)" value={state.modN10} onChange={v => update('modN10', v)} 
                   subLabel={state.modN10 > 0 ? `${Math.round(res.relayStats.q10)} gpm/車 (實際)` : `${Math.round(res.relayStats.baseQ10)} gpm/車 (理想)`} 
                   colorClass="bg-white dark:bg-slate-800"
                   statusColor={getRelayStatusColor(res.compression, state.modN10)}
                 />
                 {renderTruckDetail(state.modN10, { tFill: res.relayStats.tFill10, tDrive: res.relayStats.td10, tc: res.relayStats.tc10 }, '10噸')}
               </div>

               <div>
                 <Stepper label="12 噸車 (輛)" value={state.modN12} onChange={v => update('modN12', v)} 
                   subLabel={state.modN12 > 0 ? `${Math.round(res.relayStats.q12)} gpm/車 (實際)` : `${Math.round(res.relayStats.baseQ12)} gpm/車 (理想)`} 
                   colorClass="bg-white dark:bg-slate-800"
                   statusColor={getRelayStatusColor(res.compression, state.modN12)}
                 />
                 {renderTruckDetail(state.modN12, { tFill: res.relayStats.tFill12, tDrive: res.relayStats.td12, tc: res.relayStats.tc12 }, '12噸')}
               </div>
               
               <div className="mt-6 p-5 bg-white dark:bg-slate-800 rounded-2xl space-y-3 text-lg shadow-sm border-2 border-gray-200 dark:border-slate-600">
                  <div className="flex justify-between items-center border-b border-gray-200 dark:border-slate-600 pb-3">
                    <span className="text-black dark:text-white font-black text-xl">循環總量</span>
                    <span className="font-black text-2xl text-blue-700 dark:text-blue-300">{Math.round(res.circEff)} gpm</span>
                  </div>
                  
                  <div className="pt-2 pb-2">
                    <span className={`font-black text-xl block ${res.bottleneckMsg.includes('瓶頸') ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                      {res.bottleneckMsg}
                    </span>
                  </div>

                  {/* Detailed Relay Analysis - High Contrast */}
                  <div className="grid grid-cols-1 gap-3 text-base pt-2 text-black dark:text-white font-bold">
                    <div className="flex justify-between">
                      <span>加滿佔據水源車時間:</span>
                      <span className="font-black text-lg">{isFinite(res.tFillSource) ? res.tFillSource.toFixed(1) : '-'} 分</span>
                    </div>
                    <div className="flex justify-between">
                      <span>循環車隊平均到水時間:</span>
                      <span className="font-black text-lg">{isFinite(res.overallInterval) && res.overallInterval > 0 ? res.overallInterval.toFixed(1) : '-'} 分/次</span>
                    </div>
                    <div className="flex justify-between">
                      <span>每一輪消防栓關水等車時間:</span>
                      <span className="font-black text-lg">{isFinite(idleTime) ? idleTime.toFixed(1) : '0'} 分</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>消防栓利用率:</span>
                      <span className={`font-black px-2 py-0.5 rounded text-white ${res.hydrantUtilFrac > 1 ? 'bg-red-600' : 'bg-green-600'}`}>
                        {Math.round(res.hydrantUtilFrac * 100)}%
                      </span>
                    </div>
                    <div className="text-sm text-gray-800 dark:text-gray-300 italic text-right font-bold whitespace-pre-wrap">
                       ({res.hydrantStatusMsg})
                    </div>
                  </div>

                  <div className="mt-3 p-4 bg-gray-100 dark:bg-slate-900 rounded-xl border-2 border-gray-300 dark:border-slate-600">
                    <div className="text-base font-black text-black dark:text-white mb-1">趨勢判讀</div>
                    <div className="text-base text-gray-900 dark:text-gray-100 leading-relaxed font-bold whitespace-pre-wrap">
                      {res.twoPhaseMsg}
                    </div>
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* Page 6: Map with Auto Layout */}
        {activeTab === 'map' && (
          <div className="animate-fade-in flex flex-col h-[calc(100vh-9rem)]">
             {/* Map Frame - Flex fill */}
             <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-3xl overflow-hidden shadow-inner border-2 border-gray-300 dark:border-gray-700 relative">
                <iframe 
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.google.com/maps/d/embed?mid=${MAP_MID}&ehbc=2E312F`}
                  title="Source Map"
                  loading="lazy"
                ></iframe>
             </div>

             {/* External Map Buttons - Pinned to bottom */}
             <div className="grid grid-cols-2 gap-3 shrink-0 mt-4 pb-6">
                <button onClick={() => openMap('google')} className="bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2 border border-blue-700">
                  <span>🗺️</span> Google Map
                </button>
                <button onClick={() => openMap('mymaps')} className="bg-green-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2 border border-green-700">
                  <span>📍</span> My Maps
                </button>
             </div>
          </div>
        )}
      </main>

      {/* Persistent Footer Status Bar */}
      <footer 
        className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t-2 border-gray-300 dark:border-gray-700 p-3 shadow-2xl"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-md mx-auto flex justify-between items-center gap-4">
          <div className="flex flex-col">
             <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">淨需求</span>
             <span className={`text-2xl font-black ${res.net > 0 ? 'text-red-600' : 'text-green-600'}`}>
               {Math.round(res.net)} <span className="text-sm">gpm</span>
             </span>
          </div>
          <div className={`flex-1 flex flex-col items-center justify-center px-4 py-2 rounded-xl ${res.net > 0 ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
             <div className="text-xs font-bold opacity-80 mb-0.5">水箱撐時</div>
             <div className="text-2xl font-black leading-none">
               {res.net <= 0 
                 ? '充足 ∞' 
                 : durationDisplay.m !== '-' 
                   ? `${durationDisplay.m}分 ${durationDisplay.s}秒`
                   : '-'}
             </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
