import React, { setGlobal } from 'reactn';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import { signIn, approveSignIn, handlePassword } from '../actions/postMessage';

export default class Auth extends React.Component {

  //
  // Event Handlers
  //////////////////////////////////////////////////////////////////////////////

  handleEmail = (e) => {
    setGlobal({ email: e.target.value });
  }

  handleCode = (e) => {
    setGlobal({ token: e.target.value });
  }

  handlePassword = (e, encrypt) => {
    setGlobal({ password: e.target.value, encrypt });
  }


  //
  // Renderers
  //////////////////////////////////////////////////////////////////////////////

  renderSignInApproval = () => {
    return (
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
      </div>
    )
  }

  renderLoading = () => {
    return (
      <div>
        <div className="loader">
          <div className="loading-animation"></div>
        </div>
      </div>
    )
  }

  renderEnterNewPassword = () => {
    return (
      <div>
        <h5>You'll need a password to protect your account</h5>
        <p>Your password will never be revealed or stored, so it's important that you keep this somewhere safe. You will not be able to recovery your account without your password.</p>
        <Form onSubmit={(e) => handlePassword(e, "new-auth")}>
          <Form.Group controlId="formBasicEmail">
            <Form.Control onChange={this.handlePassword} type="password" placeholder="Your password" />
          </Form.Group>
          <Button variant="primary" type="submit">
            Next
          </Button>
        </Form>
      </div>
    )
  }

  renderEnterPassword = () => {
    return (
      <div>
        <h5>Enter your password to continue</h5>
        <p>Your password will never be revealed or stored.</p>
        <Form onSubmit={(e) => handlePassword(e, "auth")}>
          <Form.Group controlId="formBasicEmail">
            <Form.Control onChange={this.handlePassword} type="password" placeholder="Your password" />
          </Form.Group>
          <Button variant="primary" type="submit">
            Next
          </Button>
        </Form>
      </div>
    )
  }

  // Maps to unknown actions (i.e. default), which includes 'sign-in'
  renderEnterEmail = (theConfig) => {
    return (
      <div>
        <h5>{theConfig.appName} is protecting you with <mark>SimpleID</mark></h5>
        <p>The following information will be provided to the application if you log in: </p>
        <ul className="text-left">
          {
            theConfig.scopes ? theConfig.scopes.map(scope => {
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
          {/*<Form.Text className="text-muted bottom-10">
            A one-time code will be emailed to you.
          </Form.Text>*/}
          <Button variant="primary" type="submit">
            Continue
          </Button>
        </Form>
      </div>
    )
  }

  render = () => {
    const { config, action } = this.global;

    let containerElements = undefined
    switch (action) {
      case 'sign-in-approval':
        containerElements = this.renderSignInApproval()
        break
      case 'loading':
        containerElements = this.renderLoading()
        break
      case 'enter-new-password':
        containerElements = this.renderEnterNewPassword()
        break
      case 'enter-password':
        containerElements = this.renderEnterPassword()
        break
      default:  // includes 'sign-in' and anything else...
        containerElements = this.renderEnterEmail(config)
    }

    return (
      <div className="container text-center">
        {containerElements}
      </div>
    )
  }
}
