#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys
from functools import partial
import argparse

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler with no caching headers."""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
    
    def end_headers(self):
        """Add headers to prevent caching and allow CORS."""
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        
        # CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept')
        
        super().end_headers()
    
    def do_OPTIONS(self):
        """Handle OPTIONS method for CORS preflight requests."""
        self.send_response(200)
        self.end_headers()

def main(web_root, port):
    
    # Change to the desired directory
    os.chdir(web_root)
    print(f"Setting web root to: {web_root}")
    
  

    # Create a handler with the specified directory
    handler = partial(NoCacheHTTPRequestHandler, directory=web_root)
    
    # Create and start the server
    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"Serving at http://localhost:{port}")
        print("Server started successfully")
        print("Press Ctrl+C to stop the server")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    
        # Set up argument parser
    parser = argparse.ArgumentParser(description="OpenVGal. Web server launcher.")
    parser.add_argument("--content_folder", type=str, help="Path of the web root folder")
    parser.add_argument("--port", type=int, help="Port of the server")


    # Parse arguments
    args = parser.parse_args()

    # Call main function with parsed arguments
    main(web_root=args.content_folder, port=args.port)