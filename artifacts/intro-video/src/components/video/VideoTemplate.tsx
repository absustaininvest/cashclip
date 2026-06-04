import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = {
  intro: 3500,
  cashclip: 4500,
  absustain: 4500,
  backend: 3500,
  outro: 4000,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-[100vh] overflow-hidden bg-[#0F172A] text-slate-50 font-['Space_Grotesk']">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-20 mix-blend-screen"
          style={{ background: 'radial-gradient(circle, #10B981, transparent)' }}
          animate={{
            x: ['-20%', '30%', '-10%'],
            y: ['-10%', '20%', '-30%'],
            scale: [1, 1.2, 0.9],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[70vw] h-[70vw] rounded-full blur-[100px] opacity-20 mix-blend-screen right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #3B82F6, transparent)' }}
          animate={{
            x: ['20%', '-20%', '10%'],
            y: ['10%', '-30%', '20%'],
            scale: [0.9, 1.3, 1],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Persistent Midground Layer */}
      <motion.div
        className="absolute h-[2px] bg-gradient-to-r from-transparent via-[#10B981] to-transparent z-10"
        animate={{
          left: ['10%', '5%', '20%', '10%', '15%'][currentScene],
          width: ['80%', '90%', '60%', '80%', '70%'][currentScene],
          top: ['50%', '80%', '20%', '70%', '50%'][currentScene],
          opacity: [0.3, 0.6, 0.4, 0.7, 0.5][currentScene],
        }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Foreground Scenes */}
      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="intro" />}
        {currentScene === 1 && <Scene2 key="cashclip" />}
        {currentScene === 2 && <Scene3 key="absustain" />}
        {currentScene === 3 && <Scene4 key="backend" />}
        {currentScene === 4 && <Scene5 key="outro" />}
      </AnimatePresence>
    </div>
  );
}
