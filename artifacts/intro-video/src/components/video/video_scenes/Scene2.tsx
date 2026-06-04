import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),  // Slice in
      setTimeout(() => setPhase(2), 600),  // "Earn By"
      setTimeout(() => setPhase(3), 1200), // First card
      setTimeout(() => setPhase(4), 1600), // Second card
      setTimeout(() => setPhase(5), 2000), // Third card
      setTimeout(() => setPhase(6), 2400), // Fourth card
      setTimeout(() => setPhase(7), 3800), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const cards = [
    { title: 'Playing Games', color: '#00f260', icon: '🎮' },
    { title: 'Watching Videos', color: '#0052ff', icon: '📺' },
    { title: 'Taking Surveys', color: '#ff0055', icon: '📋' },
    { title: 'Completing Offers', color: '#ffb300', icon: '🎯' }
  ];

  return (
    <motion.div
      className="absolute inset-0 flex z-20 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -100, filter: 'blur(20px)' }}
      transition={{ duration: 0.8 }}
    >
      {/* Wipe element from Scene 1 entering */}
      <motion.div 
        className="absolute inset-0 bg-[#0052ff] z-50 origin-top"
        initial={{ scaleY: 1 }}
        animate={{ scaleY: 0 }}
        transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}
      />

      <div className="w-[45%] h-full flex flex-col justify-center pl-[8vw] relative z-10">
        <motion.div
          className="mb-4"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-[7vw] font-black text-white leading-[0.9] tracking-tight uppercase">
            EARN<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00f260] to-[#00b84c]">
              CASH
            </span>
          </h2>
        </motion.div>
        <motion.p
          className="text-[2vw] text-slate-300 font-light max-w-[30vw] leading-snug tracking-wide uppercase"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Doing what you<br/><span className="font-bold text-white">already do.</span>
        </motion.p>
      </div>

      <div className="w-[55%] h-full relative z-10 flex flex-col justify-center gap-[3vh] pr-[8vw] pl-[4vw]">
        {cards.map((card, i) => (
          <motion.div
            key={card.title}
            className="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl px-[3vw] py-[2.5vh] flex items-center gap-[2vw] shadow-2xl relative overflow-hidden group"
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={phase >= 3 + i ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 100, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ backgroundColor: card.color }} />
            <span className="text-[3vw] drop-shadow-lg">{card.icon}</span>
            <span className="text-[2.2vw] font-bold text-white tracking-wide uppercase">{card.title}</span>
          </motion.div>
        ))}
      </div>
      
      {/* Background shape */}
      <motion.div 
        className="absolute right-[-10vw] top-[10vh] w-[40vw] h-[40vw] rounded-full border-[1px] border-white/5 bg-white/5 backdrop-blur-sm pointer-events-none"
        initial={{ scale: 0, rotate: -45 }}
        animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -45 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.div>
  );
}
