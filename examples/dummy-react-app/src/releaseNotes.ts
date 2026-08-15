export type ReleaseNote = {
  version: string;
  summary: string;
};

export const releaseNotes: ReleaseNote[] = [
  { version: "0.1.0", summary: "First deploy." },
  { version: "0.0.2", summary: "Counted the deploys." },
  { version: "0.0.1", summary: "Nothing here yet." },
];
