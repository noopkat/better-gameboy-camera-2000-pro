import EscPosEncoder from 'esc-pos-encoder';
import Dither from 'canvas-dither';

const video = document.querySelector('video');
const canvas = document.querySelector('canvas');
const initButton = document.querySelector('#start');
const bluetoothPrintButton = document.querySelector('#select');
const webusbPrintButton = document.querySelector('#a');
const capturePhotoButton = document.querySelector('#b');

let canvasContext;
// change this if your printer's print width is larger than this
const printSize = 320; // pixels

// you can find your printer's webusb related properties via experimenting with chrome://usb-internals
const printerInterface = 0x00;
const printerEndpoint = 3;
const printerVendorId = 0x0416;
const printerProductId = 0x5011;

// you can find your printer's correct name, service and charactisitic uuids by experimenting with chrome://bluetooth-internals 
const bluetoothName = 'BlueTooth Printer';
const bluetoothService = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
const bluetoothCharacteristic = '49535343-8841-43f4-a8d4-ecbe34729bb3';

const printViaWebBluetooth = async () => {
  const bluetoothOptions = {
    filters: [
      {name: bluetoothName}
    ]
  };
 
  try { 
    const printer = await navigator.bluetooth.requestDevice(bluetoothOptions);
    const server = await printer.gatt.connect();
    const service = await server.getPrimaryService(bluetoothService);
    var characteristic = await service.getCharacteristic(bluetoothCharacteristic);
  } catch (error) {
    console.error('could not connect to printer via bluetooth:', error);
    return;
  }
  
  const imageSource = await createImageSource(); 
  const posEncoder = new EscPosEncoder();
  const encodedImage = posEncoder
      .initialize()
      .image(imageSource, printSize, printSize, 'threshold')
      .encode();
  
  // web bluetooth requires you to adhere to 512 bytes transmitted in each write call 
  // so we split our image payload into 512 byte chunks and send one at a time
  for (let i = 0; i < encodedImage.byteLength; i += 512) { 
    const chunk = encodedImage.subarray(i, i+512);
    // this is the bluetooth magic right here
    await characteristic.writeValue(chunk)
      .catch((error) => console.log('could not write to characteristic:', error));
  }

};

const printViaWebUsb = async (encodedPhoto) => {
  const usbOptions = {
    filters: [
      {
        vendorId: printerVendorId,
        productId: printerProductId
      }
  ]};
  
  try {
    var printer = await navigator.usb.requestDevice(usbOptions);

    await printer.open();
    await printer.selectConfiguration(1);
    await printer.claimInterface(printerInterface);
    await printer.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x22,
        value: 0x01,
        index: printerInterface // interface number TODO make configurable
    });
  } catch (error) {
    console.error('could not initialize web usb device:', error);
    return;
  }

  const imageSource = await createImageSource(); 
  const posEncoder = new EscPosEncoder();
  const encodedImage = posEncoder
    .initialize()
    .image(imageSource, printSize, printSize, 'threshold')
    .encode();

  printer.transferOut(printerEndpoint, encodedImage);
}; 

const createImageSource = () => {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      const blobURL = URL.createObjectURL(blob);
      const image = new Image();
      image.src = blobURL;
      image.onload = () => resolve(image);
    })
  });
};

const capturePhoto = () => {
  canvas.style.display = 'block';
  canvasContext = canvas.getContext('2d');

  // calculate smallest video dimension measurement to make captured photo a square
  const m = Math.min(video.videoWidth, video.videoHeight);
  
  // calculating how to crop the video to the middle section of the video to make a square
  const drawWidth = (video.videoWidth - m) / 2;
  const drawHeight = (video.videoHeight - m) / 2;

  canvasContext.drawImage(video, drawWidth, drawHeight, m, m, 0, 0, printSize, printSize);

  // dithering library needs a canvas object so we extract the image data again
  let imageData = canvasContext.getImageData(0, 0, canvas.width, canvas.height);
  const dithered = Dither.bayer(imageData, 150);

  // put the dithered version of the photo back onto the canvas as a print preview
  canvasContext.putImageData(dithered, 0, 0);
  video.style.display = 'none';
};

capturePhotoButton.onclick = capturePhoto; 
bluetoothPrintButton.onclick = printViaWebBluetooth; 
webusbPrintButton.onclick = printViaWebUsb; 
initButton.onclick = async () => {
  // TODO offer camera choice options to user
  const mediaOptions = {
    audio: false,
    video: true
  };
  const stream = await navigator.mediaDevices
    .getUserMedia(mediaOptions)
    .catch((error) => console.error(error));

  video.srcObject = stream;
  video.style.display = 'block';
  video.play(); 
}

// register service worker for offline caching functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      }, (error) => {
        console.error('ServiceWorker registration failed: ', error);
      });
  });
}
