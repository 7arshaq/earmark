// The shortener lives with the app so the phone can name imported files the same way.
import { shortTitle } from '../public/js/shorten.js';
export { shortTitle };

// Quick self-check: node lib/shorten.mjs
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('shorten.mjs')) {
  const cases = [
    { title: 'Rick Astley - Never Gonna Give You Up (Official Music Video) [4K]', uploader: 'Rick Astley' },
    { title: 'Andrew Huberman: The Science of Sleep — Huberman Lab Podcast #2', uploader: 'Andrew Huberman' },
    { title: 'How I Built a $10M Business in 12 Months | Full Interview | Diary of a CEO', uploader: 'The Diary Of A CEO' },
    { title: 'Joe Rogan Experience #2054 - Elon Musk', uploader: 'PowerfulJRE' },
    { title: 'THIS WILL CHANGE YOUR LIFE!!! 🔥🔥 (Must Watch) #motivation #success', uploader: 'Motiversity' },
    { title: 'The Most Incredible, Unbelievable and Completely Unexpected Discovery in the History of Modern Astrophysics Explained', uploader: 'Kurzgesagt' },
    { title: 'Naval - How to Get Rich (without getting lucky)', uploader: 'Naval' },
    { title: 'elonmusk - Huge news today', description: 'Huge news today: Starship flight 12 is go for launch next week 🚀 https://t.co/abc', extractor_key: 'Twitter', uploader: 'Elon Musk' },
    { title: 'Lofi hip hop radio 📚 beats to relax/study to', uploader: 'Lofi Girl' },
  ];
  for (const c of cases) console.log(`${c.title.slice(0, 70).padEnd(72)} → ${shortTitle(c)}`);
}
