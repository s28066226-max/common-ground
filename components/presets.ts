import type { AgeBucket } from "@/lib/taxonomy";

export interface PersonDraft {
  name: string;
  loves: string;
  age?: AgeBucket;
}

export interface Draft {
  occasion: string;
  city: string;
  budget?: "$" | "$$" | "$$$" | "$$$$";
  notes: string;
  people: PersonDraft[];
}

export const OCCASIONS = [
  "Date night",
  "Dinner with friends",
  "Weekend getaway",
  "Movie night in",
  "Team offsite",
  "Birthday night out",
  "Family reunion",
];

export const PERSON_COLORS = ["#E4572E", "#2E86AB", "#7A9E3B", "#A15DBE", "#E0A100", "#14A098"];

export const PRESETS: { label: string; blurb: string; draft: Draft }[] = [
  {
    label: "Opposites attract",
    blurb: "A third date between a cinephile and a gym rat",
    draft: {
      occasion: "Date night",
      city: "Brooklyn, NY",
      budget: "$$$",
      notes: "Third date. Want it to feel effortless, not try-hard.",
      people: [
        { name: "Maya", loves: "Wong Kar-wai, Phoebe Bridgers, Sally Rooney, natural wine, Past Lives", age: "25_to_29" },
        { name: "Jordan", loves: "Drake, Fast & Furious, Joe Rogan Experience, Nike, Korean BBQ", age: "30_to_34" },
      ],
    },
  },
  {
    label: "Three generations",
    blurb: "Grandma, dad and a Gen-Z teen in one weekend",
    draft: {
      occasion: "Weekend getaway",
      city: "Chicago",
      budget: "$$",
      notes: "Grandma can't do long walks.",
      people: [
        { name: "Rosa", loves: "Frank Sinatra, The Sound of Music, Agatha Christie, Italian food", age: "55_and_older" },
        { name: "Dan", loves: "Bruce Springsteen, Breaking Bad, Ted Lasso, craft beer, Chicago Cubs", age: "45_to_54" },
        { name: "Zoe", loves: "Olivia Rodrigo, Wednesday, Minecraft, Taylor Swift, boba tea", age: "24_and_younger" },
      ],
    },
  },
  {
    label: "The team offsite",
    blurb: "Five coworkers, zero overlap, one evening",
    draft: {
      occasion: "Team offsite",
      city: "Austin, TX",
      budget: "$$",
      notes: "Mixed drinkers and non-drinkers.",
      people: [
        { name: "Priya", loves: "Hamilton, The Bear, Anthony Bourdain, Indian street food" },
        { name: "Marcus", loves: "Kendrick Lamar, NBA 2K, Marvel movies, Texas BBQ" },
        { name: "Lena", loves: "Radiohead, Studio Ghibli, Haruki Murakami, ramen" },
        { name: "Tom", loves: "Willie Nelson, Yellowstone, fishing, Shiner Bock" },
        { name: "Aiko", loves: "BTS, Squid Game, K-beauty, Animal Crossing" },
      ],
    },
  },
];

export const EMPTY_DRAFT: Draft = {
  occasion: "Dinner with friends",
  city: "",
  budget: "$$",
  notes: "",
  people: [
    { name: "", loves: "" },
    { name: "", loves: "" },
  ],
};

export const AGE_LABELS: Record<AgeBucket, string> = {
  "24_and_younger": "≤24",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
};
