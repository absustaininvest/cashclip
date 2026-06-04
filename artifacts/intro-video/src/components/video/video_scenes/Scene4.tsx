import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200), // Base nodes
      setTimeout(() => setPhase(2), 800), // Central API
      setTimeout(() => setPhase(3), 1400), // Data particles
      setTimeout(() => setPhase(4), 3200), // Exit transition
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-20"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, rotateX: 90, filter: 'blur(20px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      style={{ perspective: 1500 }}
    >
      <div className="text-center absolute top-[10vh] w-full z-30">
        <motion.h2 
          className="text-[3vw] font-bold text-slate-300 tracking-wider uppercase"
          initial={{ opacity: 0, y: -20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        >
          Unified Architecture
        </motion.h2>
      </div>

      <motion.div 
        className="relative w-[70vw] h-[50vw] flex items-center justify-center"
        animate={{ rotateY: [0, 5, -5, 0], rotateX: [10, 15, 5, 10] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Connecting Lines */}
        <svg className="absolute inset-0 w-full h-full z-0 pointer-events-none" style={{ transform: 'translateZ(-50px)' }}>
          <motion.path
            d="M 15vw 15vw C 35vw 15vw, 25vw 25vw, 35vw 25vw"
            fill="none"
            stroke="rgba(56, 189, 248, 0.3)"
            strokeWidth="4"
            initial={{ pathLength: 0 }}
            animate={phase >= 2 ? { pathLength: 1 } : { pathLength: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
          />
          <motion.path
            d="M 55vw 35vw C 35vw 35vw, 45vw 25vw, 35vw 25vw"
            fill="none"
            stroke="rgba(56, 189, 248, 0.3)"
            strokeWidth="4"
            initial={{ pathLength: 0 }}
            animate={phase >= 2 ? { pathLength: 1 } : { pathLength: 0 }}
            transition={{ duration: 1, ease: "easeInOut", delay: 0.2 }}
          />
        </svg>

        {/* Node: CashClip */}
        <motion.div
          className="absolute left-[5vw] top-[10vw] w-[14vw] h-[10vw] rounded-xl border border-emerald-500/40 bg-emerald-900/40 flex flex-col items-center justify-center backdrop-blur-md shadow-[0_0_30px_rgba(16,185,129,0.2)]"
          style={{ transform: 'translateZ(20px)' }}
          initial={{ opacity: 0, x: -50, scale: 0.8 }}
          animate={phase >= 1 ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -50, scale: 0.8 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <span className="text-[1.5vw] font-bold text-emerald-400">CashClip App</span>
          <span className="text-[1vw] text-emerald-200/50 mt-1">Mobile</span>
        </motion.div>

        {/* Node: AB Sustain */}
        <motion.div
          className="absolute left-[5vw] bottom-[10vw] w-[14vw] h-[10vw] rounded-xl border border-blue-500/40 bg-blue-900/40 flex flex-col items-center justify-center backdrop-blur-md shadow-[0_0_30px_rgba(59,130,246,0.2)]"
          style={{ transform: 'translateZ(20px)' }}
          initial={{ opacity: 0, x: -50, scale: 0.8 }}
          animate={phase >= 1 ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -50, scale: 0.8 }}
          transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.1 }}
        >
          <span className="text-[1.5vw] font-bold text-blue-400">AB Sustain</span>
          <span className="text-[1vw] text-blue-200/50 mt-1">Web</span>
        </motion.div>

        {/* Node: Database */}
        <motion.div
          className="absolute right-[5vw] top-[20vw] w-[14vw] h-[10vw] rounded-xl border border-indigo-500/40 bg-indigo-900/40 flex flex-col items-center justify-center backdrop-blur-md shadow-[0_0_30px_rgba(99,102,241,0.2)]"
          style={{ transform: 'translateZ(-20px)' }}
          initial={{ opacity: 0, x: 50, scale: 0.8 }}
          animate={phase >= 1 ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 50, scale: 0.8 }}
          transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
        >
          <span className="text-[1.5vw] font-bold text-indigo-400">PostgreSQL</span>
          <span className="text-[1vw] text-indigo-200/50 mt-1">Database</span>
        </motion.div>

        {/* Central API */}
        <motion.div
          className="absolute left-[35vw] top-[17vw] w-[16vw] h-[16vw] rounded-2xl bg-slate-800/90 border-2 border-sky-400/50 shadow-[0_0_60px_rgba(56,189,248,0.4)] flex flex-col items-center justify-center backdrop-blur-xl z-10"
          style={{ transform: 'translateZ(50px)' }}
          initial={{ opacity: 0, scale: 0, rotateY: -90 }}
          animate={phase >= 2 ? { opacity: 1, scale: 1, rotateY: 0 } : { opacity: 0, scale: 0, rotateY: -90 }}
          transition={{ type: "spring", stiffness: 150, damping: 15 }}
        >
          <div className="absolute inset-0 rounded-2xl bg-sky-400/10 animate-pulse" />
          <div className="text-[2.5vw] font-black text-white relative z-10">Express</div>
          <div className="text-[1.2vw] text-sky-300 mt-2 font-mono relative z-10">API / Backend</div>
        </motion.div>

        {/* Animated Data Particles */}
        {phase >= 3 && (
          <>
            <motion.div 
              className="absolute w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]"
              initial={{ left: '19vw', top: '15vw' }}
              animate={{ left: '35vw', top: '25vw' }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            />
            <motion.div 
              className="absolute w-3 h-3 rounded-full bg-indigo-400 shadow-[0_0_10px_#818cf8]"
              initial={{ right: '19vw', top: '25vw' }}
              animate={{ right: '35vw', top: '25vw' }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear", delay: 0.4 }}
            />
          </>
        )}
      </motion.div>
    </motion.div>
  );
}