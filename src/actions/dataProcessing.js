import { closeWidget } from './postMessage';

export async function handleData(data) {
  if(data.type === 'segment data') {
    //Need to fetch user list that matches segment criteria
    //TODO: AC return the entire user list here so we can use it to plug into analytics service and filter

  } else if(data.type === 'email messaging') {
    //Here we will do something similar to segment data except we will send the appropriate message
    //Data should include the email template to use
  }
  closeWidget();
}