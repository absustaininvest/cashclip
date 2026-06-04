import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import abLogo from '@assets/absustain/public/logo-transparent.png';
import cashclipIcon from '@assets/cashclip/assets/images/icon.png';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-[#020617]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <motion.div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-sky-900/20 via-[#020617] to-[#020617]"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          className="text-[6vw] font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-200 to-slate-500 mb-12 tracking-tight text-center leading-none"
          initial={{ opacity: 0, scale: 0.8, y: 30, filter: 'blur(20px)' }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, scale: 0.8, y: 30, filter: 'blur(20px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Built to Scale.
        </motion.div>

        <motion.div
          className="flex gap-[6vw] items-center mt-8"
          initial={{ opacity: 0, y: 40 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 1, ease: "easeOut" }}
        >
          {/* Left Lockup */}
          <div className="flex items-center gap-6 bg-white/5 backdrop-blur-xl border border-white/10 px-8 py-6 rounded-3xl">
            <img src={cashclipIcon} className="w-[4vw] h-[4vw] drop-shadow-lg" alt="CashClip" />
            <div className="flex flex-col">
              <div className="text-[2vw] text-white font-bold leading-none">CashClip</div>
              <div className="text-[1.2vw] text-emerald-400 mt-1 font-medium tracking-wide">Rewards App</div>
            </div>
          </div>

          <motion.div 
            className="w-[2px] h-[6vw] bg-gradient-to-b from-transparent via-sky-500 to-transparent"
            initial={{ scaleY: 0 }}
            animate={phase >= 3 ? { scaleY: 1 } : { scaleY: 0 }}
            transition={{ duration: 0.8 }}
          />

          {/* Right Lockup */}
          <div className="flex items-center gap-6 bg-white/5 backdrop-blur-xl border border-white/10 px-8 py-6 rounded-3xl">
            <img src={abLogo} className="w-[4vw] h-auto max-h-[4vw] drop-shadow-lg object-contain brightness-110" alt="AB Sustain" />
            <div className="flex flex-col">
              <div className="text-[2vw] text-white font-bold leading-none">AB Sustain</div>
              <div className="text-[1.2vw] text-blue-400 mt-1 font-medium tracking-wide">Corporate</div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}