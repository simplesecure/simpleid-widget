import React, { setGlobal } from 'reactn';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import { signIn, approveSignIn } from '../actions/postMessage';

export default class Auth extends React.Component {
  handleEmail = (e) => {
    setGlobal({ email: e.target.value });
  }
  handleCode = (e) => {
    setGlobal({ token: e.target.value });
  }
  render() {
    const { config, action } = this.global;
    return (
      <div className="container text-center">
        {
          action === "sign-in-approval" ? 
          <div>
            <h5>Enter the code you received via email to continue</h5>
            <p>If you didn't receive a code, <span className="a-span" onClick={() => setGlobal({ auth: true, action: "sign-in"})}>try sending it again.</span></p>
            <Form onSubmit={approveSignIn}>
              <Form.Group controlId="formBasicEmail">
                <Form.Control onChange={this.handleCode} type="text" placeholder="123456" />
              </Form.Group>              
              <Button variant="primary" type="submit">
                Approve Sign In
              </Button>
            </Form>
          </div> : 
          action === "loading" ? 
          <div>
            <div className="loader">
              <div className="loading-animation"></div>
            </div>
          </div> : 
          <div>
            <h5>{config.appName} is protecting you with <mark>SimpleID</mark></h5> 
            <p>The following information will be provided to the application if you log in: </p>
            <ul className="text-left">
              {
                config.scopes ? config.scopes.map(scope => {
                  return (
                    <li key={scope}>{scope.charAt(0).toUpperCase() + scope.slice(1)}</li>
                  )
                }) : 
                <li>No scopes requested</li>
              }
            </ul>
            <Form onSubmit={signIn}>
              <Form.Group controlId="formBasicEmail">
                <Form.Control onChange={this.handleEmail} type="email" placeholder="your.email@email.com" />
              </Form.Group>
              <Form.Text className="text-muted bottom-10">
                A one-time code will be emailed to you.
              </Form.Text>
              <Button variant="primary" type="submit">
                Continue
              </Button>
            </Form>
          </div>
        }
      </div>
    )
  }
}