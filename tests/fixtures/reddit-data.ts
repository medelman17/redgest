import type { RedditPostData, RedditCommentData } from "@redgest/reddit";

function makePost(index: number, subreddit: string): RedditPostData {
  return {
    id: `post${index}`,
    name: `t3_post${index}`,
    subreddit,
    title: `Test Post ${index}: Interesting ${subreddit} Discussion`,
    selftext: `This is the body of test post ${index} in r/${subreddit}. It contains enough content to be meaningful for triage and summarization testing.`,
    author: `testuser${index}`,
    score: 100 + index * 50,
    num_comments: 10 + index,
    url: `https://reddit.com/r/${subreddit}/comments/post${index}`,
    permalink: `/r/${subreddit}/comments/post${index}`,
    link_flair_text: null,
    over_18: false,
    created_utc: Math.floor(Date.now() / 1000) - index * 3600,
    is_self: true,
  };
}

function makeComments(postIndex: number): RedditCommentData[] {
  return [
    {
      id: `comment${postIndex}_1`,
      name: `t1_comment${postIndex}_1`,
      author: `commenter_a${postIndex}`,
      body: `Great analysis on post ${postIndex}. I agree with the main points.`,
      score: 25,
      depth: 0,
      created_utc: Math.floor(Date.now() / 1000) - postIndex * 1800,
    },
    {
      id: `comment${postIndex}_2`,
      name: `t1_comment${postIndex}_2`,
      author: `commenter_b${postIndex}`,
      body: `Interesting perspective. Here's an additional data point for post ${postIndex}.`,
      score: 12,
      depth: 0,
      created_utc: Math.floor(Date.now() / 1000) - postIndex * 900,
    },
  ];
}

/** 3 posts with 2 comments each, for any subreddit. */
export function fixturePostsForSubreddit(subreddit: string) {
  return [0, 1, 2].map((i) => ({
    post: makePost(i, subreddit),
    comments: makeComments(i),
  }));
}
