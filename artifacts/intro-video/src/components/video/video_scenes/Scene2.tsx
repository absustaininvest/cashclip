import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import cashclipIcon from '@assets/cashclip/assets/images/icon.png';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100), // Intro
      setTimeout(() => setPhase(2), 600), // Logo
      setTimeout(() => setPhase(3), 1200), // Text elements
      setTimeout(() => setPhase(4), 1800), // Floating UI
      setTimeout(() => setPhase(5), 3800), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex z-20 overflow-hidden bg-[#052e16]"
      initial={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }}
      animate={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }}
      exit={{ clipPath: 'polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)' }}
      transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
    >
      {/* Dynamic angled background slice */}
      <motion.div 
        className="absolute top-0 right-0 w-[60%] h-full bg-emerald-500/10 origin-bottom-right"
        initial={{ skewX: 0, x: '100%' }}
        animate={phase >= 1 ? { skewX: -15, x: '10%' } : { skewX: 0, x: '100%' }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />

      <div className="w-1/2 h-full flex flex-col justify-center pl-[10vw] relative z-10">
        <motion.div
          className="w-[12vw] h-[12vw] bg-emerald-500/20 rounded-3xl shadow-[0_0_80px_rgba(16,185,129,0.4)] flex items-center justify-center mb-8 border border-emerald-400/30 backdrop-blur-xl"
          initial={{ scale: 0, rotateY: 90 }}
          animate={phase >= 2 ? { scale: 1, rotateY: 0 } : { scale: 0, rotateY: 90 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <img src={cashclipIcon} alt="CashClip" className="w-[70%] h-[70%] object-contain drop-shadow-2xl" />
        </motion.div>

        <motion.h2
          className="text-[6vw] font-black text-white leading-none tracking-tight mb-4"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          CashClip
        </motion.h2>

        <motion.p
          className="text-[1.8vw] text-emerald-100/80 font-medium max-w-[30vw] leading-snug"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Mobile rewards. Watch, earn, and withdraw to PayPal instantly.
        </motion.p>
      </div>

      <div className="w-1/2 h-full relative">
        {/* Floating abstract UI / Reward elements */}
        {['Surveys', 'Videos', 'Games', 'Offers'].map((item, i) => (
          <motion.div
            key={item}
            className="absolute bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-[2vw] py-[1.5vw] text-[1.5vw] font-bold text-white shadow-xl"
            initial={{ opacity: 0, scale: 0.5, x: 100 }}
            animate={phase >= 4 ? { 
              opacity: 1, 
              scale: 1, 
              x: 0,
              y: [0, -10, 0] // subtle floating
            } : { opacity: 0, scale: 0.5, x: 100 }}
            transition={{ 
              opacity: { duration: 0.6, delay: i * 0.15 },
              scale: { type: "spring", stiffness: 300, damping: 20, delay: i * 0.15 },
              x: { type: "spring", stiffness: 200, damping: 25, delay: i * 0.15 },
              y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: i * 0.5 }
            }}
            style={{
              top: `${20 + i * 18}%`,
              left: `${10 + (i % 2 === 0 ? 0 : 15)}%`
            }}
          >
            <span className="text-emerald-400 mr-3">✦</span>
            {item}
          </motion.div>
        ))}

        {/* Large abstract coin/shape */}
        <motion.div 
          className="absolute right-[5vw] top-[30vh] w-[25vw] h-[25vw] rounded-full border-[2vw] border-emerald-500/20"
          initial={{ scale: 0, rotate: -90 }}
          animate={phase >= 2 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -90 }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </motion.div>
  );
}