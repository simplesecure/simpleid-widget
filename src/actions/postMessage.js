import connectToParent from 'penpal/lib/connectToParent';
import { getGlobal, setGlobal } from 'reactn';

export function closeWidget() {
  const connection = connectToParent({
    // Methods child is exposing to parent
    methods: {
      multiply(num1, num2) {
        return num1 * num2;
      },
      divide(num1, num2) {
        // Return a promise if the value being returned requires asynchronous processing.
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(num1 / num2);
          }, 1000);
        });
      }
    }
  });
  
  connection.promise.then(parent => {
    parent.close().then(() => console.log("Closed"));
  });
}

export async function signIn() {
  setGlobal({ auth: true, action: "sign-in-approval" });
  const { email } = await getGlobal();
  const connection = connectToParent({
    // Methods child is exposing to parent
    methods: {
      multiply(num1, num2) {
        return num1 * num2;
      },
      divide(num1, num2) {
        // Return a promise if the value being returned requires asynchronous processing.
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(num1 / num2);
          }, 1000);
        });
      }
    }
  });
  
  connection.promise.then(parent => {
    parent.signIn({email}).then((res) => {
      if(res === true) {
        console.log("Success");
      } else {
        console.log("Failed");
      }
    });
  });
}

export async function approveSignIn() {
  setGlobal({ auth: true, action: "loading" });
  const { email, token } = await getGlobal();
  const connection = connectToParent({
    // Methods child is exposing to parent
    methods: {
      multiply(num1, num2) {
        return num1 * num2;
      },
      divide(num1, num2) {
        // Return a promise if the value being returned requires asynchronous processing.
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(num1 / num2);
          }, 1000);
        });
      }
    }
  });
  
  connection.promise.then(parent => {
    parent.signIn({email, token}).then((res) => {
      if(res === true) {
        console.log("Success");
        closeWidget(true);
      } else {
        console.log("Failed");
      }
    });
  });
}

