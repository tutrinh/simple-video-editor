import type { PracticeStory } from "./storyCoach";

export interface StoryExample {
  id: string;
  title: string;
  story: PracticeStory;
}

export const STORY_EXAMPLES: StoryExample[] = [
  {
    id: "first-post",
    title: "The video I almost never posted",
    story: {
      platform: "Instagram Reels",
      audience: "new creators afraid to post",
      objective: "feel ready to publish an imperfect first video",
      steps: {
        hook: "I recorded my first video twelve times—and almost deleted the only take that sounded like me.",
        beginning: "I had spent weeks studying creators I admired, so when I finally pressed record, I tried to sound exactly like them.",
        problem: "Every polished sentence felt fake. The more I rehearsed, the less confident I became, and the video stayed trapped in my drafts.",
        journey: "On the twelfth take I lost my place, laughed, and finished without restarting. I watched it back expecting another failure, but it was the first time I recognized my own voice.",
        resolution: "I posted that imperfect take. People responded to the honesty, not the polish, and a few said they had been afraid to start too.",
        ending: "Your first post does not need to prove you are talented. It only needs to begin your practice.",
      },
    },
  },
  {
    id: "morning-walk",
    title: "The ten-minute promise",
    story: {
      platform: "TikTok",
      audience: "busy people trying to rebuild a healthy habit",
      objective: "believe that a small repeatable habit can create momentum",
      steps: {
        hook: "The habit that changed my mornings was so small it almost felt pointless.",
        beginning: "After months of saying I would get back in shape, I kept designing perfect workout plans and abandoning them by Wednesday.",
        problem: "I was waiting to feel motivated enough for an hour-long routine, which meant most days I did nothing at all.",
        journey: "So I made one rule: walk for ten minutes before checking my phone. Some mornings I stopped at ten. Other mornings, ten became thirty without a fight.",
        resolution: "A month later, the real win was not distance or weight. I had become someone who kept one promise to myself every morning.",
        ending: "Make the first version of your habit too easy to avoid, then let consistency make it bigger.",
      },
    },
  },
  {
    id: "client-no",
    title: "The project I finally turned down",
    story: {
      platform: "LinkedIn",
      audience: "freelancers who struggle to protect their time",
      objective: "see that a thoughtful no can make room for better work",
      steps: {
        hook: "Saying no to my biggest client felt irresponsible—until I saw what saying yes was costing me.",
        beginning: "The account looked successful from the outside: steady work, recognizable name, and enough revenue to keep my calendar full.",
        problem: "But every brief expanded, every deadline moved forward, and I was rushing the smaller clients who trusted me most.",
        journey: "I tried new boundaries, tighter scopes, and one last reset meeting. When nothing changed, I calculated the hidden hours and realized the impressive account was my least sustainable one.",
        resolution: "I ended the contract respectfully and used the open time to improve my process. Within two months, two smaller clients expanded their work with me.",
        ending: "Revenue tells you what a project pays. Your calendar tells you what it costs.",
      },
    },
  },
  {
    id: "family-recipe",
    title: "The recipe with no measurements",
    story: {
      platform: "YouTube Shorts",
      audience: "people preserving family traditions",
      objective: "inspire viewers to record the ordinary knowledge in their families",
      steps: {
        hook: "My grandmother's best recipe had one problem: she had never measured a single ingredient.",
        beginning: "Every holiday she made the same bread from memory, adding flour by feel and stopping when the dough looked right.",
        problem: "When I asked her to write it down, her instructions were things like ‘enough’ and ‘until it listens.’ I realized the recipe could disappear with her routine.",
        journey: "We spent one afternoon cooking side by side. I weighed every handful, filmed every fold, and asked what she noticed in the dough that a written recipe could not explain.",
        resolution: "The first measured batch was not perfect, but together we corrected it. Now our family has the recipe—and a recording of her teaching it.",
        ending: "The everyday things your family knows by heart are worth documenting before they become memories.",
      },
    },
  },
];

export function randomStoryExample(excludeId?: string, random: () => number = Math.random): StoryExample {
  const choices = STORY_EXAMPLES.filter((example) => example.id !== excludeId);
  const pool = choices.length > 0 ? choices : STORY_EXAMPLES;
  return pool[Math.floor(random() * pool.length)] ?? STORY_EXAMPLES[0];
}
