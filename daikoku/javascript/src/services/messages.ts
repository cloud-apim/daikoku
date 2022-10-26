import orderBy from 'lodash/orderBy';
import last from 'lodash/last';

let callback: any = [];

let eventSource: any;

const MessagesEvents = {
  start() {
    if (window.EventSource) {
      console.log('Initialising server sent event');
      eventSource = new EventSource('/api/messages/_sse');
      eventSource.addEventListener(
        'open',
        () => {
          // console.log('SSE opened');
        },
        false
      );
      eventSource.addEventListener(
        'error',
        () => {
          // console.error('SSE error', e);
        },
        false
      );
      eventSource.addEventListener(
        'message',
        (e: any) => {
          // console.log('New event', e);
          const data = JSON.parse(e.data);
          callback.forEach((item: any) => item.cb(data));
        },
        false
      );
    }
  },
  stop() {
    if (eventSource) {
      eventSource.close();
    }
  },
};

export { MessagesEvents };

export function addCallback(cb: any, id: any) {
  callback = [...callback, { cb, id }];
}

export function removeCallback(id: any) {
  callback = callback.filter((c: any) => c.id !== id);
}

export const fromMessagesToDialog = (messages: any) =>
  orderBy(messages, ['date']).reduce((dialog, message) => {
    if (!dialog.length) {
      return [[message]];
    } else {
      const l: any = last(dialog);
      if (l.some((m: any) => m.sender === message.sender)) {
        return [...dialog.slice(0, dialog.length - 1), [...l, message]];
      } else {
        return [...dialog, [message]];
      }
    }
  }, []);
