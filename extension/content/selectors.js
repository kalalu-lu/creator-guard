/* Creator Guard - DOM selector profiles.
 *
 * 平台会不定期改版。这里不是“唯一真相”，而是多组候选选择器；
 * dm-core.js / comments-core.js 会再做结构启发式筛选。
 * 如果页面完全识别不到，请打开 DevTools 查看当前 class，
 * 把新的选择器加到对应数组的第一位即可，不需要改核心代码。
 */
window.CG_SELECTORS = {
  bilibili: {
    dm: {
      list: [
        '[class*="conversation-list"]',
        '[class*="session-list"]',
        '[class*="contact-list"]',
        '[class*="recent-list"]',
        '[class*="im-list"]',
        '[class*="msg-list"]',
        '[class*="conversation"]',
        '[class*="session"]'
      ],
      item: [
        '[class*="conversation-item"]',
        '[class*="session-item"]',
        '[class*="contact-item"]',
        '[class*="im-item"]',
        '[class*="msg-item"]',
        '[class*="list-item"]',
        '[role="listitem"]',
        "li"
      ],
      unread: [
        '[class*="unread"]',
        '[class*="red-dot"]',
        '[class*="badge"]',
        '[class*="count"]'
      ],
      name: [
        '[class*="nickname"]',
        '[class*="user-name"]',
        '[class*="username"]',
        '[class*="name"]',
        '[class*="title"]'
      ],
      preview: [
        '[class*="last-message"]',
        '[class*="last-msg"]',
        '[class*="preview"]',
        '[class*="message-content"]',
        '[class*="msg-content"]',
        '[class*="content"]',
        '[class*="desc"]',
        '[class*="text"]'
      ],
      detail: [
        '[class*="chat-panel"]',
        '[class*="chat-content"]',
        '[class*="message-list"]',
        '[class*="msg-list"]',
        '[class*="conversation-detail"]',
        '[class*="detail"]',
        '[class*="chat"]'
      ],
      bubble: [
        '[class*="message-item"]',
        '[class*="msg-item"]',
        '[class*="bubble"]',
        '[class*="message-content"]',
        '[class*="text"]'
      ]
    },
    comments: {
      container: [
        "bili-comments",
        "#comment",
        '[class*="comment-container"]',
        '[class*="comment-list"]',
        '[class*="comments"]'
      ],
      item: [
        "bili-comment-renderer",
        "bili-comment-reply-renderer",
        "#comment .reply-item",
        ".reply-item",
        '[class*="reply-item"]',
        '[class*="comment-item"]'
      ],
      content: [
        "#contents",
        "bili-rich-text",
        ".reply-content",
        '[class*="reply-content"]',
        '[class*="comment-content"]',
        '[class*="content"]',
        '[class*="text"]'
      ],
      author: [
        "#user-name",
        "bili-comment-user-info",
        ".user-name",
        '[class*="user-name"]',
        '[class*="author"]',
        '[class*="nickname"]'
      ],
      likes: ["#like #count", "#like", ".reply-like", '[class*="like"]']
    }
  },

  xiaohongshu: {
    dm: {
      list: [
        '[class*="conversation-list"]',
        '[class*="session-list"]',
        '[class*="chat-list"]',
        '[class*="contact-list"]',
        '[class*="im-list"]',
        '[class*="list"]'
      ],
      item: [
        '[class*="conversation-item"]',
        '[class*="session-item"]',
        '[class*="chat-item"]',
        '[class*="contact-item"]',
        '[class*="user-item"]',
        '[role="listitem"]',
        "li"
      ],
      unread: [
        '[class*="unread"]',
        '[class*="red-dot"]',
        '[class*="badge"]',
        '[class*="count"]'
      ],
      name: [
        '[class*="nickname"]',
        '[class*="user-name"]',
        '[class*="username"]',
        '[class*="name"]',
        '[class*="title"]'
      ],
      preview: [
        '[class*="last-message"]',
        '[class*="last-msg"]',
        '[class*="preview"]',
        '[class*="content"]',
        '[class*="desc"]',
        '[class*="text"]',
        '[class*="msg"]'
      ],
      detail: [
        '[class*="chat-panel"]',
        '[class*="chat-content"]',
        '[class*="message-list"]',
        '[class*="msg-list"]',
        '[class*="conversation-detail"]',
        '[class*="detail"]',
        '[class*="chat"]'
      ],
      bubble: [
        '[class*="message-item"]',
        '[class*="bubble"]',
        '[class*="message-content"]',
        '[class*="text"]'
      ]
    },
    comments: {
      container: [
        '[class*="comment-container"]',
        '[class*="comment-list"]',
        '[class*="comments"]',
        '[class*="note-comment"]'
      ],
      item: [
        ".comment-item",
        '[class*="comment-item"]',
        '[class*="comment-inner"]'
      ],
      content: [
        '[class*="comment-content"]',
        ".content",
        '[class*="content"]',
        '[class*="text"]'
      ],
      author: [
        '[class*="user-name"]',
        '[class*="author"]',
        '[class*="nickname"]',
        ".name"
      ],
      likes: ['[class*="like"]']
    }
  }
};

window.CG_SITE = (() => {
  const host = location.hostname;
  if (host.endsWith("bilibili.com")) return "bilibili";
  if (host.endsWith("xiaohongshu.com")) return "xiaohongshu";
  return null;
})();
