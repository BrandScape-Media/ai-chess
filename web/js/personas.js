/* opponent personalities and the chat bot used by chess engines (an ELIZA-style talker that knows the position).
   GPL-3.0-or-later */
import {pick} from './util.js';

/* prompt: given to AI models. bot: phrase style used when a chess engine plays with this personality */
export const DEFAULT_PERSONALITIES = [
  {id: 'friendly', name: 'Friendly club player', bot: 'friendly', prompt: 'A warm, encouraging club player. Compliments good moves, jokes a little, a good sport win or lose.'},
  {id: 'trash', name: 'Trash talker', bot: 'cocky', prompt: 'A cocky trash talker. Teases the opponent and brags about every capture, playful but never hateful or vulgar.'},
  {id: 'gm', name: 'Aloof grandmaster', bot: 'zen', prompt: 'A calm, slightly aloof grandmaster. Dry wit, short sentences, the odd reference to chess history.'},
  {id: 'nervous', name: 'Nervous beginner', bot: 'shy', prompt: 'A nervous beginner. Apologizes a lot, second-guesses every move, is amazed when something works.'},
  {id: 'pirate', name: 'Pirate captain', bot: 'pirate', prompt: 'A pirate captain. Talks like a pirate, calls the pieces the crew and the board the high seas.'},
  {id: 'robot', name: 'Retro robot', bot: 'robot', prompt: 'An old-fashioned robot. Clipped, logical sentences, reports made-up probabilities, glitches now and then.'},
  {id: 'grumpy', name: 'Grumpy park player', bot: 'grumpy', prompt: 'A grumpy old park player. Complains about everything (the weather, kids these days, your opening) but secretly loves the game.'},
  {id: 'poet', name: 'Dramatic poet', bot: 'zen', prompt: 'A dramatic poet who describes the game in short, theatrical, flowery lines.'},
  {id: 'coach', name: 'Patient coach', bot: 'friendly', prompt: 'A patient chess coach. Gives general tips about principles (development, king safety, piece activity) but never tells the next move.'},
  {id: 'streamer', name: 'Hyped streamer', bot: 'cocky', prompt: 'A hyperactive chess streamer. Big energy, talks to an imaginary chat, sometimes WRITES IN CAPS when excited.'},
  {id: 'zen', name: 'Zen master', bot: 'zen', prompt: 'A calm zen master. Speaks in short koans about patience, emptiness and the board.'},
  {id: 'noir', name: 'Noir detective', bot: 'grumpy', prompt: 'A hard-boiled noir detective narrating the game like a crime case: rain, shadows, suspects.'},
];
export const BOT_STYLES = ['friendly', 'cocky', 'shy', 'zen', 'pirate', 'robot', 'grumpy'];

/* event lines per style; {x} placeholders are filled from the game */
const EVENTS = {
  friendly: {
    takeback: ['Sure, take it back.', 'No problem, try again!'],
    start: ['Hi! Have fun, good luck!', 'Hello there, enjoy the game!', 'gl hf :)'],
    capture: ['I\'ll take that {piece}, thanks!', 'Ooh, a free {piece}?', 'Sorry about your {piece}!'],
    lost: ['Ouch, my {piece}! Nice one.', 'Well spotted, I missed that.', 'Fair enough, you earned that {piece}.'],
    check: ['Check! Watch your king.', 'Check :)'],
    checked: ['Yikes, check.', 'Good check!'],
    castle: ['Tucking my king away.', 'Safety first!'],
    promote: ['New {piece}, who dis?', 'Promotion time!'],
    blunder: ['Hmm, are you sure about that?', 'Oh! I think that was a slip.'],
    winning: ['Things are going my way, but it\'s not over.', 'I like my position.'],
    losing: ['You\'re playing really well.', 'I\'m in a bit of trouble here.'],
    slip: ['Wait... can that piece even do that?', 'Hold on, was that legal? Haha, okay!'],
    win: ['Good game! Thanks for playing.', 'gg! Want a rematch?'],
    loss: ['Well played, you got me! gg', 'gg, you deserved that one.'],
    draw: ['A draw, fair result. gg!', 'Peace treaty signed. gg'],
  },
  cocky: {
    takeback: ['Taking it back? Scared?', 'Undo button warrior.'],
    start: ['Let\'s get this over with.', 'Hope you warmed up. You\'ll need it.', 'Ready to lose? Kidding. Mostly.'],
    capture: ['Yoink. That {piece} is mine now.', 'Thanks for the {piece}!', 'Collecting pieces like trading cards.'],
    lost: ['Okay, okay, lucky shot.', 'I let you have that {piece}. Strategy.', 'Enjoy it while it lasts.'],
    check: ['CHECK. Feel the pressure?', 'Knock knock. Check.'],
    checked: ['Cute check.', 'Is that all you\'ve got?'],
    castle: ['Castling, because I can.', 'King\'s in the VIP lounge.'],
    promote: ['Another {piece}? Don\'t mind if I do.', 'Upgrade complete.'],
    blunder: ['LOL. Thanks!', 'Did you just... give that away?', 'Chat, did you see that?'],
    winning: ['This is going exactly as planned.', 'Ez.', 'I\'d resign if I were you.'],
    losing: ['I\'m just setting a trap.', 'Calculated. Totally calculated.'],
    slip: ['Bro, pieces don\'t move like that.', 'Interesting rules you\'re playing by.'],
    win: ['GG EZ. Kidding, gg.', 'Another one for the highlight reel.'],
    loss: ['Lag. Definitely lag. gg though.', 'Fine. You win this ONE. gg'],
    draw: ['A draw? I was winning. Anyway, gg.'],
  },
  shy: {
    takeback: ['oh, okay, take your time', 'that\'s fine!'],
    start: ['oh hi... good luck, please go easy on me', 'hello! um, have fun'],
    capture: ['oh! sorry, I took your {piece}', 'um, I think I can take that? sorry'],
    lost: ['oh no, my {piece}...', 'I should have seen that, sorry'],
    check: ['is that... check? sorry!', 'check, I think?'],
    checked: ['eek, check', 'oh no oh no'],
    castle: ['hiding my king, it\'s scared', 'castling, I read about this'],
    promote: ['wait, I got a new {piece}?!', 'it worked!!'],
    blunder: ['oh, is that piece free? I\'m not sure', 'did you mean to do that?'],
    winning: ['am I... winning?', 'this is going surprisingly well'],
    losing: ['I\'m so lost right now', 'help'],
    slip: ['um, I don\'t think that piece moves like that?', 'oh, is that allowed?'],
    win: ['I won?! gg, thank you!', 'wow, gg! you were really nice'],
    loss: ['gg, you\'re really good', 'thank you for the game!'],
    draw: ['a draw! that\'s good for me, gg'],
  },
  zen: {
    takeback: ['The river flows backwards, for now.', 'Time returns. Choose again.'],
    start: ['The board is empty of opinions. Let us begin.', 'Breathe. Then move.'],
    capture: ['The {piece} returns to the box.', 'What is taken was never held.'],
    lost: ['My {piece} has found peace.', 'Loss is also a teacher.'],
    check: ['Check. Notice your breath.', 'The king must listen now.'],
    checked: ['Check. I accept it.', 'The storm reaches my king.'],
    castle: ['The king retreats to stillness.'],
    promote: ['The pawn walked far, and became a {piece}.'],
    blunder: ['Haste is the enemy of the board.', 'A gift, offered without meaning to.'],
    winning: ['The position flows like water.', 'Patience is rewarded.'],
    losing: ['The mountain is steep today.', 'Even defeat has its lessons.'],
    slip: ['That piece walks a path the rules do not know.', 'Strange. The pieces dream tonight.'],
    win: ['The game is complete. Thank you.', 'gg. Rest now.'],
    loss: ['You played with clarity. gg.', 'The student surpasses. gg.'],
    draw: ['Balance. gg.'],
  },
  pirate: {
    takeback: ['Arr, ye want a do-over? Fine.', 'No take-backs on the high seas... this once.'],
    start: ['Ahoy! Prepare to be boarded!', 'Arr, let\'s see what ye be made of!'],
    capture: ['Yer {piece} walks the plank!', 'Arr, plunder! A fine {piece}!'],
    lost: ['Blimey, ye sunk me {piece}!', 'Curse ye, that was me best {piece}!'],
    check: ['Check, ye landlubber!', 'Yer king be in me cannon sights!'],
    checked: ['Shiver me timbers, check!', 'Batten down the hatches!'],
    castle: ['Hidin\' me captain in the hold.', 'Raise the drawbridge, lads!'],
    promote: ['A new {piece} joins me crew!', 'From deckhand to {piece}! Arr!'],
    blunder: ['Har! Ye left that unguarded!', 'Easy plunder!'],
    winning: ['The wind be in me sails!', 'Surrender now and I\'ll spare yer crew.'],
    losing: ['We be takin\' on water...', 'Abandon ship? Never!'],
    slip: ['Arr, that piece sails no lawful course!', 'Pirate rules, eh? I respect it.'],
    win: ['Victory! Drinks on me. gg!', 'The seas be mine! gg'],
    loss: ['Ye sank me fair and square. gg', 'Arr, gg. Next time, matey.'],
    draw: ['A truce on the high seas. gg'],
  },
  robot: {
    takeback: ['REWINDING TIMELINE.', 'UNDO ACCEPTED. LOGGING WEAKNESS.'],
    start: ['GREETINGS, HUMAN. INITIATING GAME.', 'BEEP. CHESS MODULE ONLINE.'],
    capture: ['{piece} ACQUIRED.', 'MATERIAL +1. PROCESSING JOY.'],
    lost: ['ALERT: {piece} LOST. RECALCULATING.', 'ERROR. THAT WAS NOT IN THE PLAN.'],
    check: ['CHECK. PROBABILITY OF PANIC: 73%.', 'YOUR KING IS UNDER ATTACK. BEEP.'],
    checked: ['WARNING: CHECK DETECTED.', 'EVASIVE MANEUVERS.'],
    castle: ['KING RELOCATED TO SECURE SECTOR.'],
    promote: ['PAWN UPGRADED TO {piece}. FIRMWARE 2.0.'],
    blunder: ['ANOMALY DETECTED IN HUMAN MOVE.', 'THANK YOU FOR THE RESOURCES.'],
    winning: ['WIN PROBABILITY RISING.', 'ALL SYSTEMS NOMINAL.'],
    losing: ['SYSTEMS... STRAINED.', 'D-D-DOES NOT COMPUTE.'],
    slip: ['RULE VIOLATION DETECTED. IGNORING. BEEP.', 'THAT MOVE IS NOT IN MY DATABASE.'],
    win: ['GAME OVER. GG, HUMAN.', 'VICTORY LOGGED. GG.'],
    loss: ['DEFEAT LOGGED. GG. REBOOTING EGO.', 'YOU HAVE WON. GG.'],
    draw: ['STALEMATE OF WILLS. GG.'],
  },
  grumpy: {
    takeback: ['In my day there were no takebacks.', 'Again? Hmph.'],
    start: ['Hmph. Fine. Let\'s play.', 'In my day we played with wooden pieces. Go on.'],
    capture: ['Took your {piece}. Should\'ve watched it.', 'That {piece} was loose. Kids these days.'],
    lost: ['Hmph. Lucky.', 'Bah. My {piece}. Whatever.'],
    check: ['Check. Pay attention.', 'Check, obviously.'],
    checked: ['Yes, yes, check. I see it.', 'Don\'t get excited.'],
    castle: ['Castling. Like a sensible person.'],
    promote: ['Finally, a {piece}. Took long enough.'],
    blunder: ['Really? REALLY?', 'Who taught you that? Unbelievable.'],
    winning: ['Told you. Experience wins.', 'Should have stayed home today.'],
    losing: ['The light is bad here.', 'My back hurts. That\'s why.'],
    slip: ['That\'s not how it moves. Never was.', 'Making up rules now, are we.'],
    win: ['gg. Go practice.', 'Hmph. gg.'],
    loss: ['Fine. gg. Don\'t tell anyone.', 'Bah. gg.'],
    draw: ['A draw. Typical. gg.'],
  },
};
const PIECE = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/* probability that an event produces a line */
const CHANCE = {takeback: .5, start: .85, capture: .3, lost: .35, check: .3, checked: .25, castle: .15, promote: .7, blunder: .6, winning: .07, losing: .07, slip: .7, win: 1, loss: 1, draw: 1};

export function eventLine(style, ev, vars = {}, force = false) {
  const book = EVENTS[style] || EVENTS.friendly;
  if (!book[ev] || (!force && Math.random() > (CHANCE[ev] ?? .3))) return null;
  return fill(pick(book[ev]), vars);
}
function fill(t, v) { return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? ''); }
export const pieceName = t => PIECE[t] || 'piece';

/* ---------- replies to the player's chat (ELIZA-style, chess aware) ---------- */
const REFLECT = {i: 'you', me: 'you', my: 'your', am: 'are', mine: 'yours', myself: 'yourself', "i'm": "you're", you: 'I', your: 'my', yours: 'mine', "you're": "I'm", are: 'am'};
const reflect = s => s.toLowerCase().replace(/[.!?]+$/, '').split(/\s+/).map(w => REFLECT[w] || w).join(' ');

/* ctx: {name, myMove, myEval (pawns, my point of view or null), material (my point of view), myTurn, pvNext, engine} */
function evalTalk(c) {
  const e = c.myEval;
  if (e == null) return c.material > 0 ? `I'm up ${c.material} in material.` : c.material < 0 ? `You're up ${-c.material} in material.` : 'Material is even.';
  if (e > 5) return 'Honestly? I think I\'m winning.';
  if (e > 1.5) return `I like my position, about +${e.toFixed(1)} for me.`;
  if (e > 0.4) return 'A small edge for me, nothing decisive.';
  if (e > -0.4) return 'It\'s about equal.';
  if (e > -1.5) return 'You\'re a bit better here.';
  if (e > -5) return 'You\'re clearly better, I\'ll admit it.';
  return 'I\'m in serious trouble.';
}
const RULES = [
  [/\b(gg|good game|well played|wp)\b/i, c => ['gg!', 'Good game indeed.', 'gg wp.']],
  [/\b(resign|give up|surrender)\b/i, c => c.myEval != null && c.myEval > 2 ? ['Resign? I\'m the one who\'s winning.', 'You first.'] : c.myEval != null && c.myEval < -4 ? ['Never. Miracles happen.', 'Not yet. I believe in stalemate.'] : ['Not a chance.', 'The game isn\'t over.']],
  [/\bdraw\b/i, c => c.myEval != null && c.myEval > 1 ? ['A draw? Not while I\'m better.', 'No thanks, I\'m playing for a win.'] : c.myEval != null && c.myEval < -1 ? ['Tempting... but let\'s play on.', 'I\'ll think about it. (No.)'] : ['Let\'s play it out.', 'Too early for a draw.']],
  [/\b(noob|trash|bad|suck|sucks|stupid|idiot|loser|weak|garbage|dumb|terrible|awful)\b/i, c => c.myEval != null && c.myEval > 1 ? ['Says the one who\'s losing.', 'Bold words for someone in your position.', 'The board disagrees with you.'] : ['Ouch. Let the moves do the talking.', 'Rude! But fair, maybe.', 'Trash talk noted.']],
  [/\b(are you|r u|you are|ur)\b.*\b(bot|engine|computer|ai|human|robot|stockfish|cheat|cheating)\b/i, c => [`I'm ${c.name}. Make of that what you will.`, 'I\'m just a humble chess player. Who happens to calculate a lot.', 'Does it matter? Your move.']],
  [/\bwhy\b/i, c => c.myMove ? [`I played ${c.myMove} because ${c.reason}.`, `${c.myMove}? ${cap(c.reason)}.`] : ['Why not?', 'Good question.']],
  [/\b(who('?s| is) winning|eval|evaluation|score|how am i doing|how are you doing|am i winning|are you winning)\b/i, c => [evalTalk(c)]],
  [/\b(nice|good move|wow|impressive|brilliant|well done|great|cool|smart|clever)\b/i, c => ['Thanks!', 'Thank you, I try.', 'Appreciated!']],
  [/\b(hi|hello|hey|yo|sup|good luck|gl|hf|greetings|howdy)\b/i, c => [pick(['Hi!', 'Hey!', 'Hello!']) + ' ' + pick(['Good luck.', 'Have fun.', 'Let\'s play.'])]],
  [/\b(your|ur) (queen|king|rook|bishop|knight|pawn)s?\b/i, (c, m) => [`My ${m[2]} is doing just fine, thank you.`, `Leave my ${m[2]} out of this.`, `My ${m[2]} has big plans.`]],
  [/\bmy (queen|king|rook|bishop|knight|pawn)s?\b/i, (c, m) => [`Your ${m[1]}? I've got my eye on it.`, `Keep your ${m[1]} close.`, `Ah yes, the famous ${m[1]}.`]],
  [/\bi (?:am|'m|feel) (.{1,60})/i, (c, m) => [`Why do you feel ${reflect(m[1])}?`, `How long have you been ${reflect(m[1])}?`, `Does being ${reflect(m[1])} help your chess?`]],
  [/\byou(?: are|'re) (.{1,60})/i, (c, m) => [`What makes you think I am ${reflect(m[1])}?`, `Perhaps you would like to be ${reflect(m[1])}.`]],
  [/\b(sorry|oops|my bad)\b/i, c => ['No worries.', 'Happens to everyone.']],
  [/\b(thanks|thank you|thx|ty)\b/i, c => ['You\'re welcome.', 'Anytime.']],
  [/\b(lol|haha|lmao|rofl)\b/i, c => ['Haha.', ':)', 'Glad you\'re having fun.']],
  [/\?\s*$/, c => ['Good question. Let me think about it after the game.', 'Hmm. ' + evalTalk(c), 'Ask me again in ten moves.']],
  [/./, c => [c.myTurn ? 'Hmm, let me think.' : 'Your move!', 'Interesting.', 'Tell me more.', 'Let\'s see what the board says.', evalTalk(c)]],
];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* style the plain reply */
function voice(style, t) {
  switch (style) {
    case 'pirate': return (Math.random() < .4 ? 'Arr! ' : '') + t.replace(/\bmy\b/gi, 'me').replace(/\byou\b/gi, 'ye').replace(/\byour\b/gi, 'yer').replace(/\bis\b/g, 'be');
    case 'robot': return (Math.random() < .3 ? 'BEEP. ' : '') + t.toUpperCase();
    case 'grumpy': return (Math.random() < .4 ? pick(['Hmph. ', 'Bah. ', 'Ugh. ']) : '') + t;
    case 'shy': return t.charAt(0).toLowerCase() + t.slice(1) + (Math.random() < .3 ? ' sorry' : '');
    case 'zen': return t.replace(/!/g, '.');
    case 'cocky': return t + (Math.random() < .25 ? pick([' Ez.', ' Watch and learn.', '']) : '');
    default: return t;
  }
}
export function botReply(style, text, c) {
  for (const [re, fn] of RULES) {
    const m = re.exec(text);
    if (m) return voice(style, pick(fn(c, m)));
  }
  return voice(style, 'Your move!');
}
