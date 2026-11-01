// The words of the story system: press conferences, decisions, texts and posts.
// {team}, {opp}, {pts}, {rival}, {mentor} and {name} are filled in when an event fires.
import type { CareerStage, StoryChoice } from "../types";

export interface EventTemplate {
  id: string;
  title: string;
  from?: string;
  body: string;
  choices: StoryChoice[];
  stages?: CareerStage[];
  /** Fires at most once in a career. */
  once?: boolean;
}

const answer = (text: string, reply: string, fx: Omit<StoryChoice, "text" | "reply"> = {}): StoryChoice => ({ text, reply, ...fx });

/** Answers that fit most press conferences. */
const NO_COMMENT = answer("No comment.", "The room moved on, a little annoyed.", { media: -3 });

export const POSTGAME_WIN: EventTemplate[] = [
  {
    id: "pg-win-1",
    title: "Postgame interview",
    from: "Courtside reporter",
    body: "{pts} points tonight against {opp}. What was working?",
    choices: [
      answer("My teammates kept finding me. They deserve this one.", "The clip went over well in the locker room.", {
        confident: -0.1,
        star: -0.15,
        teammates: 4,
        fans: 1,
      }),
      answer("Honestly? Nobody out there can guard me.", "It's already all over the internet.", {
        confident: 0.2,
        star: 0.15,
        fans: 3,
        media: 3,
        teammates: -3,
      }),
      answer("We just stuck to the game plan.", "A quiet answer. Coaches love those.", { star: -0.05, coach: 3 }),
    ],
  },
  {
    id: "pg-win-2",
    title: "Postgame press conference",
    from: "Beat reporter",
    body: "You took over late against {opp}. Did you want that last shot?",
    choices: [
      answer("I want every last shot. That's who I am.", "The headline writes itself.", { confident: 0.2, star: 0.1, media: 3, fans: 3 }),
      answer("Coach drew it up. I just knocked it down.", "Your coach smiled when the quote got back to him.", { confident: -0.1, coach: 4 }),
      answer("Whoever's open takes it. Tonight that was me.", "A veteran answer.", { star: -0.15, teammates: 3 }),
    ],
  },
];

export const POSTGAME_LOSS: EventTemplate[] = [
  {
    id: "pg-loss-1",
    title: "After the loss",
    from: "Beat reporter",
    body: "That one got away against {opp}. What happened out there?",
    choices: [
      answer("That's on me. I'll be better.", "Owning it earned you some respect.", { confident: -0.1, star: -0.1, teammates: 4, media: 2 }),
      answer("Some guys need to look in the mirror.", "Your teammates saw that quote before you got to the bus.", { star: 0.2, teammates: -7, media: 3 }),
      answer("Give them credit. They played well.", "Fair, and forgettable.", { media: 1 }),
      NO_COMMENT,
    ],
  },
  {
    id: "pg-loss-2",
    title: "After the loss",
    from: "Columnist",
    body: "People are starting to ask questions about this team. Are you worried?",
    choices: [
      answer("Not at all. Long season.", "Steady. The room moved on.", { confident: 0.05, coach: 2 }),
      answer("Yes, and everyone in that locker room should be.", "It stung, but maybe it needed saying.", {
        star: 0.1,
        confident: 0.1,
        teammates: -3,
        fans: 3,
      }),
      answer("We need to trust the coaches and each other.", "Your coach appreciated that one.", { star: -0.1, coach: 4, teammates: 2 }),
    ],
  },
];

export const POSTSEASON: EventTemplate[] = [
  {
    id: "pg-big-1",
    title: "Big win, big stage",
    from: "National reporter",
    body: "Everyone's watching now. What does a win like this mean to you?",
    choices: [
      answer("It means we're not done yet.", "Cold-blooded. The clip played all night.", { confident: 0.1, fans: 4, media: 2 }),
      answer("I thought about everyone who helped me get here.", "Back home, a lot of people teared up.", {
        confident: -0.1,
        fans: 5,
        impact: 1,
        impactText: "Thanked your hometown on the big stage",
      }),
      answer("This is what I've been saying all along.", "You sure have. Now everyone's listening.", { confident: 0.2, star: 0.1, media: 4, teammates: -2 }),
    ],
  },
];

export const RIVAL_GAME: EventTemplate[] = [
  {
    id: "rival-won",
    title: "You beat your rival",
    from: "Reporter",
    body: "You and {rival} have been going at it for years, and tonight you got the better of it. Anything to say?",
    choices: [
      answer("Tell {rival} I said good game.", "Classy. {rival} posted a thumbs-up.", { confident: -0.1, fans: 3, media: 2 }),
      answer("Same result as always.", "{rival} saw it. Next one's going to be personal.", { confident: 0.2, fans: 4, media: 3 }),
    ],
  },
  {
    id: "rival-lost",
    title: "Your rival got you",
    from: "Reporter",
    body: "{rival} was talking to your bench all night, and {rival} got the win. Your reaction?",
    choices: [
      answer("They earned it. I'll see them again.", "A short answer with a long memory.", { confident: -0.05, media: 2 }),
      answer("Enjoy it. It won't happen twice.", "Bulletin board material.", { confident: 0.2, fans: 3 }),
    ],
  },
];

export const MEDIA_DAY: Record<"hs" | "college" | "pro", EventTemplate> = {
  hs: {
    id: "md-hs",
    title: "Preseason story",
    from: "Local paper",
    body: "The paper is doing a preview of {team}. What are your goals this year?",
    choices: [
      answer("Win state. Nothing less.", "That's going on the bulletin board at every gym in the region.", { confident: 0.15, media: 2, fans: 2 }),
      answer("Get better every day and help my team.", "A coach's dream answer.", { confident: -0.1, star: -0.1, coach: 3 }),
    ],
  },
  college: {
    id: "md-col",
    title: "Media day",
    from: "Campus TV",
    body: "New season at {team}. What should fans expect from you?",
    choices: [
      answer("An All-American season.", "Bold. The comments section is split.", { confident: 0.2, star: 0.1, fans: 3, media: 3 }),
      answer("A lot of wins, whatever my role is.", "Your coach forwarded that one to the staff.", { star: -0.15, coach: 4 }),
      answer("I'm here to get better and enjoy it.", "Nice and easy.", { confident: -0.05, fans: 1 }),
    ],
  },
  pro: {
    id: "md-pro",
    title: "Media day",
    from: "League reporter",
    body: "Big year ahead for {team}. Where do you see yourself this season?",
    choices: [
      answer("MVP conversation. Write that down.", "They did.", { confident: 0.2, star: 0.15, media: 4, fans: 3, teammates: -2 }),
      answer("We're chasing a title. Individual stuff comes after.", "The room nodded. So did the locker room.", { star: -0.15, teammates: 4, coach: 2 }),
      answer("One game at a time.", "Nobody wrote that down.", { media: -1 }),
    ],
  },
};

export const SCRIPTED: Record<string, EventTemplate> = {
  draft: {
    id: "sc-draft",
    title: "Draft night press conference",
    from: "League reporter",
    body: "Congratulations. What are you bringing to {team}?",
    choices: [
      answer("A championship, eventually.", "The fans will remember you said that.", { confident: 0.2, fans: 4, media: 3 }),
      answer("Hard work. I'm here to learn from the vets.", "The vets noticed.", { confident: -0.15, star: -0.1, teammates: 5, coach: 3 }),
      answer("I'm just thankful for my family right now.", "It was a good moment.", { confident: -0.1, fans: 3 }),
    ],
  },
  traded: {
    id: "sc-traded",
    title: "Trade press conference",
    from: "Team reporter",
    body: "Welcome to {team}. How do you feel about the move?",
    choices: [
      answer("Grateful for my old city, ready for this one.", "A clean exit and a good start.", { star: -0.1, fans: 4, teammates: 3 }),
      answer("They'll regret trading me.", "Your new fans loved it. Your old ones didn't.", { confident: 0.2, fans: 3, media: 4 }),
    ],
  },
  deadline: {
    id: "sc-deadline",
    title: "Trade deadline rumors",
    from: "League insider",
    body: "Your name keeps coming up before the deadline. Do you want to stay at {team}?",
    choices: [
      answer("This is my team. I'm not going anywhere.", "The fans loved hearing that.", { star: -0.15, fans: 5, coach: 3 }),
      answer("It's a business. I'm focused on the next game.", "Careful, and fine.", { media: 1 }),
      answer("I want to win. Wherever that is.", "That sent a message to the front office.", {
        confident: 0.15,
        star: 0.15,
        media: 4,
        coach: -5,
        teammates: -3,
      }),
    ],
  },
  title: {
    id: "sc-title",
    title: "Champions",
    from: "National reporter",
    body: "You did it! Confetti's still falling. Who's this for?",
    choices: [
      answer("My teammates. Every single one.", "Your teammates got you with the water bottles.", { star: -0.2, teammates: 6, fans: 3 }),
      answer("Everyone who said I couldn't.", "That quote is on a T-shirt by morning.", { confident: 0.2, media: 4, fans: 4 }),
      answer("{mentor}. I owe them everything.", "{mentor} watched it from home and called right away.", { confident: -0.1, fans: 4, media: 2 }),
    ],
  },
};

export const RANDOM_EVENTS: EventTemplate[] = [
  // high school
  {
    id: "hs-party",
    stages: ["hs"],
    title: "Friday night",
    from: "A friend from school",
    body: "There's a big party the night before your next game. Everyone's going.",
    choices: [
      answer("Stay home and rest up.", "You felt great at shootaround.", { coach: 3, star: -0.05 }),
      answer("Go for a little while.", "You had fun, and paid for it a little the next day.", { coach: -3, teammates: 3 }),
    ],
  },
  {
    id: "hs-tutor",
    stages: ["hs"],
    title: "Study hall",
    from: "Teammate",
    body: "A younger teammate is failing math and might sit out the season. They asked if you'd help.",
    choices: [
      answer("Tutor them after practice.", "They passed. Their family sent cookies.", {
        star: -0.15,
        teammates: 5,
        impact: 2,
        impactText: "Tutored a teammate through finals",
      }),
      answer("You've got your own work to do.", "Fair. It was a little awkward at practice.", { teammates: -2 }),
    ],
  },
  {
    id: "hs-paper",
    stages: ["hs"],
    title: "Letter to the editor",
    from: "Local paper",
    body: "The town's youth league lost its gym, and a reporter wants a quote from you to help the fundraiser.",
    choices: [
      answer("Show up in person and run a free clinic.", "A hundred kids showed up.", {
        fans: 5,
        impact: 3,
        impactText: "Ran a free clinic to save the youth league",
      }),
      answer("Give them a quote.", "It helped a little.", { fans: 1, media: 2 }),
    ],
  },
  {
    id: "hs-sibling",
    stages: ["hs"],
    title: "Family first",
    from: "Mom",
    body: "Your little sister's recital is the same night as an optional team workout.",
    choices: [
      answer("Go to the recital.", "She spotted you in the third row.", { star: -0.1, coach: -1, fans: 1 }),
      answer("Go to the workout.", "You got better. She'll understand. Probably.", { coach: 3 }),
    ],
  },
  // college
  {
    id: "col-booster",
    stages: ["college"],
    title: "A quiet offer",
    from: "A booster",
    body: "A big donor pulls you aside: a nice car, no paperwork, nobody has to know.",
    choices: [
      answer("Say no and tell compliance.", "It was the right call. The coach thanked you.", { coach: 5, star: -0.1 }),
      answer("Turn it down quietly.", "Nothing more came of it.", { media: 0 }),
      answer("Take the keys.", "A reporter started asking questions a week later.", { confident: 0.1, star: 0.1, coach: -8, media: -8 }),
    ],
  },
  {
    id: "col-class",
    stages: ["college"],
    title: "Finals week",
    from: "Academic advisor",
    body: "Your big paper is due the morning you leave for a road game.",
    choices: [
      answer("Pull an all-nighter and finish it.", "You were tired, but you got an A.", { coach: 2, confident: -0.05 }),
      answer("Ask for an extension.", "The professor agreed, with a look.", {}),
    ],
  },
  {
    id: "col-camp",
    stages: ["college"],
    title: "Spring break",
    from: "Campus outreach",
    body: "The team's helping at a kids' hospital over break. It's optional.",
    choices: [
      answer("Go, and bring your teammates.", "Those kids will talk about it for years.", {
        star: -0.1,
        teammates: 3,
        fans: 4,
        impact: 5,
        impactText: "Brought your team to a children's hospital",
      }),
      answer("Use the break to rest.", "You needed it.", {}),
    ],
  },
  {
    id: "col-star",
    stages: ["college"],
    title: "Locker room",
    from: "Teammate",
    body: "A senior starter says you're taking too many shots.",
    choices: [
      answer("Talk it out and ask what they see.", "It turned into a good conversation.", { star: -0.15, teammates: 5 }),
      answer("Tell them to make you stop in practice.", "Practice got very intense.", { confident: 0.15, star: 0.1, teammates: -4, coach: 1 }),
    ],
  },
  // pros
  {
    id: "pro-foundation",
    stages: ["pro"],
    once: true,
    title: "Your foundation",
    from: "Your agent",
    body: "You've got the money and the name to start a foundation back in {hometown}. It'll take real time.",
    choices: [
      answer("Build courts and after-school programs at home.", "Kids in {hometown} are playing on your courts.", {
        star: -0.2,
        fans: 8,
        media: 5,
        impact: 30,
        impactText: "Started a foundation in your hometown",
      }),
      answer("Write a check for now.", "It helped, and nobody saw it.", { impact: 5, impactText: "Donated to your hometown schools" }),
      answer("Not right now.", "There's always next year.", {}),
    ],
  },
  {
    id: "pro-hospital",
    stages: ["pro"],
    title: "A letter from a fan",
    from: "Team community office",
    body: "A nine-year-old in the local children's hospital wrote you a letter.",
    choices: [
      answer("Go visit, with no cameras.", "You stayed for three hours.", {
        confident: -0.1,
        fans: 2,
        impact: 8,
        impactText: "Visited a young fan in the hospital",
      }),
      answer("Record a video message.", "They watched it twenty times.", { fans: 2, impact: 2, impactText: "Sent a video to a young fan" }),
    ],
  },
  {
    id: "pro-camp",
    stages: ["pro"],
    title: "Summer camp",
    from: "Your agent",
    body: "A free basketball camp for kids who can't afford one needs a name to run it.",
    choices: [
      answer("Run it yourself, every day.", "Five hundred kids learned the jump stop from you.", { fans: 5, impact: 10, impactText: "Ran a free summer camp" }),
      answer("Stop by on the last day.", "They were thrilled anyway.", { fans: 2, impact: 2, impactText: "Visited a kids' camp" }),
    ],
  },
  {
    id: "pro-rookie",
    stages: ["pro"],
    title: "The new kid",
    from: "Assistant coach",
    body: "A nervous rookie on the team is struggling. They could use someone to take them under their wing.",
    choices: [
      answer("Take them to dinner and work out together.", "They've looked like a different player since.", { star: -0.15, teammates: 6, coach: 3 }),
      answer("Let them figure it out, like you had to.", "They did, more or less.", { confident: 0.05, teammates: -2 }),
    ],
  },
  {
    id: "pro-club",
    stages: ["pro"],
    title: "Road trip",
    from: "Teammate",
    body: "A few of the guys are hitting a club in town. Game's tomorrow night.",
    choices: [
      answer("Stay in and get extra shots up.", "The arena staff let you in at midnight.", { coach: 4, star: -0.05 }),
      answer("One drink, then bed.", "You kept the group together.", { teammates: 3 }),
      answer("Stay out all night.", "There are photos.", { star: 0.1, teammates: 2, coach: -5, media: -5 }),
    ],
  },
  {
    id: "pro-beef",
    stages: ["pro"],
    title: "Locker room trouble",
    from: "Team captain",
    body: "Two teammates are fighting over shots, and the whole room's taking sides.",
    choices: [
      answer("Get them in a room and settle it.", "They shook on it. You've become a real leader.", { star: -0.15, teammates: 6, coach: 3 }),
      answer("Stay out of it.", "It simmered for weeks.", { teammates: -2 }),
      answer("Tell them the offense runs through you anyway.", "That ended the fight. It also started a new one.", {
        confident: 0.2,
        star: 0.25,
        teammates: -6,
      }),
    ],
  },
  {
    id: "pro-ad",
    stages: ["pro"],
    title: "Commercial shoot",
    from: "Your agent",
    body: "A national ad wants you on your only off day this month.",
    choices: [
      answer("Do the ad.", "You're on every TV in the country.", { star: 0.1, fans: 4, media: 3, coach: -2 }),
      answer("Rest. The job comes first.", "Your legs thanked you.", { coach: 3 }),
    ],
  },
  {
    id: "pro-social",
    stages: ["pro"],
    title: "Social media storm",
    from: "Team PR",
    body: "A stranger posted a harsh clip of your worst game, and it's everywhere.",
    choices: [
      answer("Laugh it off and repost it.", "The internet decided you're fun.", { confident: 0.05, fans: 5 }),
      answer("Fire back.", "It kept the clip going for another week.", { confident: 0.15, media: -4, fans: -2 }),
      answer("Ignore it.", "It faded in a few days.", {}),
    ],
  },
  // any level
  {
    id: "any-mentor",
    title: "A call from your mentor",
    from: "{mentor}",
    body: '"You\'re doing fine, kid. But tell me honestly: are you having fun out there?"',
    choices: [
      answer("It's all I've ever wanted.", '"Good. Remember this feeling."', { confident: -0.05 }),
      answer("It's work now. I want to be the greatest.", '"Then get to the gym. I\'ll be watching."', { confident: 0.15, star: 0.1 }),
    ],
  },
  {
    id: "any-family",
    title: "Back home",
    from: "Dad",
    body: "Your grandfather isn't doing well, and he'd love to see you. It'd mean missing practice.",
    choices: [
      answer("Go home.", "You sat with him and watched old games. Nobody said a word about practice.", { star: -0.1, coach: -2, fans: 2 }),
      answer("Call him tonight instead.", "He told you to go win one for him.", { coach: 1 }),
    ],
  },
  {
    id: "any-kid",
    title: "After the game",
    from: "Security guard",
    body: "A kid in your jersey has been waiting by the tunnel for an hour after the crowd left.",
    choices: [
      answer("Give them your shoes and sign everything.", "That kid will never forget it.", { fans: 3, impact: 2, impactText: "Made a young fan's night" }),
      answer("Wave on your way out.", "You had a bus to catch.", { fans: -1 }),
    ],
  },
];

export const TEXTS = {
  welcome: ["Hey, this is {mentor}. Yes, that {mentor}. Your coach sent me your film. I think you might have something. I'll be checking in."],
  madeTeam: ["Proud of you! Dinner's on us tonight."],
  calledUp: ["Moved up already? Don't get comfortable. The next level always comes for you."],
  award: ["Saw the {award} news. Nice. Don't let it go to your head.", "{award}. Your mom cried, by the way. Well done."],
  enrolled: ["College is where it gets real. Everyone was the best player in their town. Outwork them."],
  drafted: ["You made it. I remember my draft night. Now the real work starts.", "We're all crying here. So proud of you."],
  injured: ["I heard. Take your time and do the rehab right. I lost a season rushing back.", "Are you okay? Call me when you can. Love you."],
  traded: ["Trades are part of it. New city, same game. Be early and be a pro."],
  rivalIntro: ["Word is a kid named {rival} at {rivalTeam} thinks they're better than you. Thought you should know."],
  champion: ["You did it. I've got chills. Call me when the party's over."],
  badGame: ["Short memory. Next one."],
  parkUnlock: ["They're talking about you at {text} now. Go see if you can run with them."],
} as const;

export const POSTS = {
  fanGood: [
    "{name} is HIM.",
    "Somebody check on {opp}. {name} just cooked them for {pts}.",
    "I told y'all about {name}.",
    "{pts} tonight from {name}. This kid is special.",
    "Watching {name} is why I pay for this.",
  ],
  fanBad: ["Tough night for {team}.", "Bench {name}? Hear me out.", "We'll be fine. Right? Right?"],
  award: ["Congrats to {name}: {award}.", "{award}. {name} keeps stacking them up."],
  move: ["{text}"],
  park: ["{name} just pulled up to {text}. Bring your own ball.", "The regulars at {text} heard about {name}. They want a run."],
  rival: ["{rival} vs {name} never disappoints.", "Best rivalry in basketball? {name} and {rival}."],
  rivalNews: ["{rival} went off last night. Is {rival} better than {name}? Discuss.", "Scouts are buzzing about {rival}. {name} might have competition."],
};

export const FAN_NAMES = [
  "HoopsHead",
  "BucketsDaily",
  "AZPrepsFan",
  "CourtVision",
  "BaselineBob",
  "TheFilmRoom",
  "RimRocker",
  "SixthManSam",
  "DeepThree",
  "FullCourtPress",
];
