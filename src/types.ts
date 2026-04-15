/**
 * Common types for the Kwami Navigation Extension.
 */

export type KwamiSource = 'kwami-playground' | 'kwami-nav-tab' | 'kwami-extension';

export type NavAction = 'navigate' | 'back' | 'forward' | 'close' | 'click' | 'type' | 'press_key' | 'scroll' | 'read_page';

export interface NavCommandDetail {
  action: NavAction;
  url?: string;
  description?: string;
  text?: string;
  elementId?: string;
  element_id?: string;
  callbackId?: string;
}

export interface NavMessage {
  source?: KwamiSource;
  type: string;
  detail?: NavCommandDetail;
  url?: string;
  title?: string;
  content?: any;
  [key: string]: any;
}

export interface NavStatePayload {
  url: string;
  title: string;
  isLoading: boolean;
}

export interface PageContentPayload {
  title: string;
  text: string;
  elements: any[];
  html: string;
}

export interface CommandResultPayload {
  result: 'ok' | 'not_found' | 'not_input' | 'error';
  [key: string]: any;
}
