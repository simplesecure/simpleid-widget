import React, { setGlobal } from 'reactn';
import 'bootstrap/dist/css/bootstrap.min.css';
import './assets/css/theme.css';
import './assets/css/loader-pulse.css';
import './assets/css/styles.css';
// import Token from './components/Token';
// import Email from './components/Email';
import Header from './components/Header';
import Footer from './components/Footer';
import Auth from './containers/Auth';
import Approve from './containers/Approve';
import Modal from 'react-bootstrap/Modal';

export default class App extends React.Component {

  componentDidMount() {
//
  }

  componentWillUnmount() {
    setGlobal({
      auth: true,
      action: "sign-in", 
      approval: false, 
      pendingToken: false, 
      config: {}, 
      email: "",
      token: "", 
      password: "", 
      keychain: {}, 
      encrypt: false, 
      txDetails: {}, 
      error: "", 
      subaction: ""
    })
  }

  render() {
    const { auth } = this.global;
    return (
      <Modal show={true}>
        <Header />
        <Modal.Body>
          {
            auth ? 
            <Auth /> : 
            <Approve />
          }
        </Modal.Body>
        <Modal.Footer>
          <Footer /> 
        </Modal.Footer>
      </Modal>
    )
  }
}