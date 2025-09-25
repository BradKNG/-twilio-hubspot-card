import React, { useState, useEffect, useRef } from 'react';

// IMPORTANT: Twilio SDKs are loaded from a CDN in HubSpot's environment.
// We declare them as window properties to inform our linter they exist.
const { Twilio } = window;

const TwilioCrmCard = ({ hubspot }) => {
  const [twilioDevice, setTwilioDevice] = useState(null);
  const [syncClient, setSyncClient] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [callStatus, setCallStatus] = useState('Idle');
  const [incomingCall, setIncomingCall] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const messagesEndRef = useRef(null);

  // Replace with your actual sales rep ID and Twilio Function domain
  const salesRepId = 'rep_jane_doe'; // This should be dynamic in a real app
  const functionDomain = 'https://hubspot-crm-sync-1923.twil.io'; 

  const contactPhoneNumber = hubspot.contact.properties.phone;
  const repPhoneNumber = '+19049446544'; // The Twilio # for this rep

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Effect to initialize Twilio SDKs
  useEffect(() => {
    const initializeTwilio = async () => {
      if (!contactPhoneNumber) {
        setError('Contact has no phone number.');
        setIsLoading(false);
        return;
      }

      try {
        // 1. Fetch the Twilio Token from our function
        const response = await fetch(`${functionDomain}/twilio-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salesRepId }),
        });
        const data = await response.json();
        const { token } = data;

        if (!token) throw new Error('Failed to retrieve Twilio token.');

        // 2. Initialize the Twilio Voice Device
        const device = new Twilio.Device(token, {
          codecPreferences: ['opus', 'pcmu'],
        });

        device.on('ready', () => {
          setCallStatus('Ready');
          setTwilioDevice(device);
        });
        device.on('error', (err) => {
          console.error('Twilio Device Error:', err);
          setError('Voice connection error.');
          setCallStatus('Error');
        });
        device.on('connect', () => setCallStatus('On Call'));
        device.on('disconnect', () => setCallStatus('Ready'));
        device.on('incoming', (conn) => {
            setIncomingCall(conn);
            setCallStatus('Incoming');
        });
        
        // 3. Initialize the Twilio Sync Client
        const sync = new Twilio.Sync.Client(token);
        sync.on('connectionStateChanged', (state) => {
          if (state === 'connected') {
            setSyncClient(sync);
          } else {
             console.error('Sync connection lost:', state);
             setError('Real-time chat connection lost.');
          }
        });
        
      } catch (err) {
        console.error('Initialization failed:', err);
        setError('Could not initialize Twilio services.');
        setIsLoading(false);
      }
    };

    initializeTwilio();

    return () => {
      twilioDevice?.destroy();
      syncClient?.shutdown();
    };
  }, []); // Run only once on component mount

  // Effect to subscribe to the Sync List for messages
  useEffect(() => {
    if (!syncClient || !contactPhoneNumber) return;
    
    const listUniqueName = `chat_${contactPhoneNumber.replace(/\+/g, '')}_${repPhoneNumber.replace(/\+/g, '')}`;

    const subscribeToMessages = async () => {
      try {
        const list = await syncClient.list(listUniqueName);
        
        const initialItems = await list.getItems({ pageSize: 100 });
        setMessages(initialItems.items.map(item => item.data));
        setIsLoading(false);
        
        list.on('itemAdded', (event) => {
          setMessages(prev => [...prev, event.item.data]);
        });
      } catch (error) {
         if (error.code === 54301) { // List not found
             console.log('No previous chat history found.');
         } else {
            console.error('Sync List subscription error:', error);
            setError('Could not load chat history.');
         }
         setIsLoading(false);
      }
    };

    subscribeToMessages();

  }, [syncClient, contactPhoneNumber]);


  const handleSendMessage = async () => {
    if (!newMessage.trim() || !contactPhoneNumber) return;

    try {
      await fetch(`${functionDomain}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: contactPhoneNumber,
          from: repPhoneNumber,
          body: newMessage,
          salesRepId: salesRepId
        }),
      });
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send message:', err);
      setError('Message failed to send.');
    }
  };
  
  const handleCall = () => {
    if (twilioDevice && callStatus === 'Ready' && contactPhoneNumber) {
      twilioDevice.connect({ params: { To: contactPhoneNumber } });
    }
  };

  const handleHangup = () => {
    twilioDevice?.disconnectAll();
  };

  const handleAcceptCall = () => {
      incomingCall?.accept();
      setCallStatus('On Call');
      setIncomingCall(null);
  };
  
  const handleRejectCall = () => {
      incomingCall?.reject();
      setCallStatus('Ready');
      setIncomingCall(null);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '10px', fontSize: '14px', height: '500px', display: 'flex', flexDirection: 'column' }}>
      {error && <div style={{ color: 'red', padding: '5px', border: '1px solid red', marginBottom: '10px' }}>{error}</div>}
      
      {/* Call Controls */}
      <div style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid #ccc' }}>
        <h4 style={{ margin: '0 0 5px 0' }}>Voice Call</h4>
        <p style={{ margin: 0, fontSize: '12px', color: '#555' }}>Status: {callStatus}</p>
        
        {callStatus === 'Incoming' && (
             <div style={{ marginTop: '5px' }}>
                <p>Incoming call from {incomingCall.parameters.From}</p>
                <button onClick={handleAcceptCall} style={{...buttonStyle, backgroundColor: '#28a745'}}>Accept</button>
                <button onClick={handleRejectCall} style={{...buttonStyle, backgroundColor: '#dc3545', marginLeft: '5px'}}>Reject</button>
            </div>
        )}
        
        {['Ready', 'On Call'].includes(callStatus) && (
            <div style={{ marginTop: '5px' }}>
                <button onClick={handleCall} disabled={callStatus !== 'Ready'} style={buttonStyle}>Call {contactPhoneNumber}</button>
                <button onClick={handleHangup} disabled={callStatus !== 'On Call'} style={{...buttonStyle, marginLeft: '5px'}}>Hang Up</button>
            </div>
        )}
      </div>

      {/* Messaging */}
      <h4 style={{ margin: '0 0 5px 0' }}>Text Messaging</h4>
      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #ccc', padding: '8px', marginBottom: '10px', backgroundColor: '#f9f9f9' }}>
        {isLoading ? (
          <p>Loading messages...</p>
        ) : messages.length > 0 ? (
          messages.map((msg, index) => (
            <div key={index} style={msg.direction === 'outbound' ? messageOutbound : messageInbound}>
              {msg.body}
            </div>
          ))
        ) : (
          <p>No messages yet.</p>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ display: 'flex' }}>
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          style={{ flex: 1, marginRight: '5px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
          placeholder="Type a message..."
        />
        <button onClick={handleSendMessage} style={buttonStyle}>Send</button>
      </div>
    </div>
  );
};

// Simple styling objects
const buttonStyle = {
  padding: '8px 12px',
  border: 'none',
  backgroundColor: '#007a9b',
  color: 'white',
  borderRadius: '4px',
  cursor: 'pointer',
};

const messageStyle = {
  padding: '6px 10px',
  borderRadius: '15px',
  marginBottom: '5px',
  maxWidth: '80%',
  wordWrap: 'break-word',
};

const messageInbound = {
  ...messageStyle,
  backgroundColor: '#e1e1e1',
  alignSelf: 'flex-start',
};

const messageOutbound = {
  ...messageStyle,
  backgroundColor: '#d1eaff',
  alignSelf: 'flex-end',
  marginLeft: 'auto',
};

export default TwilioCrmCard;

